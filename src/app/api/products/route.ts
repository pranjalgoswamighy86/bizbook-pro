import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    // -------------------------------------------------------
    // CREATE - New product with BOM ingredients
    // -------------------------------------------------------
    if (action === 'create') {
      const { tenantId, data } = body

      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { name, description, sku, category, salePrice, gstRate, ingredients } = data

      // Create the Product record
      const product = await db.product.create({
        data: {
          name,
          description: description || null,
          sku: sku || null,
          category: category || null,
          salePrice: salePrice ?? 0,
          gstRate: gstRate ?? 0,
          tenantId,
        },
      })

      // Create all ProductIngredient records
      if (ingredients && ingredients.length > 0) {
        await db.productIngredient.createMany({
          data: ingredients.map(
            (ing: { inventoryItemId: string; quantity: number; unit?: string; notes?: string }) => ({
              productId: product.id,
              inventoryItemId: ing.inventoryItemId,
              quantity: ing.quantity,
              unit: ing.unit || 'PCS',
              notes: ing.notes || null,
            })
          ),
        })
      }

      // Auto-create an InventoryItem for this finished product
      const inventoryItem = await db.inventoryItem.create({
        data: {
          name,
          sku: sku || null,
          unit: 'PCS',
          category: category || null,
          itemType: 'FINISHED_PRODUCT',
          purchasePrice: 0, // cost is computed from BOM
          salePrice: salePrice ?? 0,
          currentStock: 0, // stock managed through production/conversion
          tenantId,
        },
      })

      // Return the full product with ingredients
      const result = await db.product.findUnique({
        where: { id: product.id },
        include: {
          ingredients: {
            include: {
              inventoryItem: {
                select: { name: true, currentStock: true, unit: true, purchasePrice: true },
              },
            },
          },
        },
      })

      return NextResponse.json({ product: result, inventoryItem })
    }

    // -------------------------------------------------------
    // UPDATE - Update product and its BOM
    // -------------------------------------------------------
    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const { name, description, sku, category, salePrice, gstRate, ingredients } = data

      // Update the Product record
      const product = await db.product.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description: description || null }),
          ...(sku !== undefined && { sku: sku || null }),
          ...(category !== undefined && { category: category || null }),
          ...(salePrice !== undefined && { salePrice }),
          ...(gstRate !== undefined && { gstRate }),
        },
      })

      // If ingredients provided, delete old and recreate (simplest for SQLite)
      if (ingredients !== undefined) {
        await db.productIngredient.deleteMany({ where: { productId: id } })

        if (ingredients.length > 0) {
          await db.productIngredient.createMany({
            data: ingredients.map(
              (ing: { inventoryItemId: string; quantity: number; unit?: string; notes?: string }) => ({
                productId: id,
                inventoryItemId: ing.inventoryItemId,
                quantity: ing.quantity,
                unit: ing.unit || 'PCS',
                notes: ing.notes || null,
              })
            ),
          })
        }
      }

      // Update the linked InventoryItem (match by name + tenantId + FINISHED_PRODUCT)
      const existingInventory = await db.inventoryItem.findFirst({
        where: {
          tenantId: product.tenantId,
          itemType: 'FINISHED_PRODUCT',
          name: product.name,
        },
      })

      if (existingInventory) {
        await db.inventoryItem.update({
          where: { id: existingInventory.id },
          data: {
            ...(name !== undefined && { name }),
            ...(sku !== undefined && { sku: sku || null }),
            ...(category !== undefined && { category: category || null }),
            ...(salePrice !== undefined && { salePrice }),
          },
        })
      }

      // Return the updated product with ingredients
      const result = await db.product.findUnique({
        where: { id },
        include: {
          ingredients: {
            include: {
              inventoryItem: {
                select: { name: true, currentStock: true, unit: true, purchasePrice: true },
              },
            },
          },
        },
      })

      return NextResponse.json({ product: result })
    }

    // -------------------------------------------------------
    // DELETE - Delete a product
    // -------------------------------------------------------
    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body

      // Get product info before deleting (to find linked inventory item)
      const product = await db.product.findUnique({ where: { id } })
      if (!product) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      }

      // Delete ProductIngredient records first (cascade should handle this, but explicit for safety)
      await db.productIngredient.deleteMany({ where: { productId: id } })

      // Soft-delete the Product
      await db.product.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })

      // Do NOT delete the linked InventoryItem — keep it as-is
      // (it remains as FINISHED_PRODUCT type with its stock history)

      return NextResponse.json({ success: true })
    }

    // -------------------------------------------------------
    // LIST - List all products for a tenant with ingredients
    // -------------------------------------------------------
    if (action === 'list') {
      const { tenantId, search, category } = body

      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const where: Record<string, unknown> = { tenantId, isDeleted: false }

      if (search || category) {
        if (search) {
          // Search by name or sku
          where.OR = [
            { name: { contains: search } },
            { sku: { contains: search } },
          ]
        }
        if (category) {
          if (search) {
            // Both search and category: OR for search, AND category
            delete where.OR
            where.AND = [
              {
                OR: [
                  { name: { contains: search } },
                  { sku: { contains: search } },
                ],
              },
              { category },
            ]
          } else {
            where.category = category
          }
        }
      }

      const products = await db.product.findMany({
        where,
        include: {
          ingredients: {
            include: {
              inventoryItem: {
                select: { name: true, currentStock: true, unit: true, purchasePrice: true },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      })

      return NextResponse.json({ products })
    }

    // -------------------------------------------------------
    // PRODUCE - Convert raw materials into finished product
    // -------------------------------------------------------
    if (action === 'produce') {
      const { tenantId, productId, quantity } = body

      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      if (!productId || !quantity || quantity <= 0) {
        return NextResponse.json(
          { error: 'productId and a positive quantity are required' },
          { status: 400 }
        )
      }

      // Get the product with its BOM ingredients
      const product = await db.product.findUnique({
        where: { id: productId },
        include: {
          ingredients: {
            include: {
              inventoryItem: true,
            },
          },
        },
      })

      if (!product || product.isDeleted) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      }

      if (product.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      // Validate sufficient stock for each raw material
      const shortages: { name: string; required: number; available: number; shortBy: number }[] = []
      for (const ingredient of product.ingredients) {
        const requiredQty = quantity * ingredient.quantity
        const availableQty = ingredient.inventoryItem.currentStock
        if (availableQty < requiredQty) {
          shortages.push({
            name: ingredient.inventoryItem.name,
            required: requiredQty,
            available: availableQty,
            shortBy: requiredQty - availableQty,
          })
        }
      }

      if (shortages.length > 0) {
        return NextResponse.json(
          { error: 'Insufficient raw material stock', shortages },
          { status: 400 }
        )
      }

      // Deduct raw materials from inventory
      for (const ingredient of product.ingredients) {
        const deductQty = quantity * ingredient.quantity
        const newStock = ingredient.inventoryItem.currentStock - deductQty
        await db.inventoryItem.update({
          where: { id: ingredient.inventoryItemId },
          data: {
            currentStock: newStock,
            value: newStock * ingredient.inventoryItem.purchasePrice,
          },
        })
      }

      // Add to finished product inventory item
      const finishedItem = await db.inventoryItem.findFirst({
        where: {
          tenantId,
          itemType: 'FINISHED_PRODUCT',
          name: product.name,
          isDeleted: false,
        },
      })

      let updatedFinishedStock = 0
      if (finishedItem) {
        const newStock = finishedItem.currentStock + quantity
        await db.inventoryItem.update({
          where: { id: finishedItem.id },
          data: {
            currentStock: newStock,
            value: newStock * finishedItem.purchasePrice,
          },
        })
        updatedFinishedStock = newStock
      }

      return NextResponse.json({
        success: true,
        produced: quantity,
        finishedProductStock: updatedFinishedStock,
        message: `Successfully produced ${quantity} unit(s) of ${product.name}`,
      })
    }

    // -------------------------------------------------------
    // GET-COST - Calculate cost of producing one unit
    // -------------------------------------------------------
    if (action === 'get-cost') {
      const { tenantId, productId } = body

      const product = await db.product.findUnique({
        where: { id: productId },
        include: {
          ingredients: {
            include: {
              inventoryItem: {
                select: { name: true, purchasePrice: true, unit: true, currentStock: true },
              },
            },
          },
        },
      })

      if (!product || product.isDeleted) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      }

      if (product.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      let totalCost = 0
      const ingredientCosts = product.ingredients.map((ing) => {
        const lineCost = ing.quantity * ing.inventoryItem.purchasePrice
        totalCost += lineCost
        return {
          name: ing.inventoryItem.name,
          quantity: ing.quantity,
          unit: ing.unit,
          purchasePrice: ing.inventoryItem.purchasePrice,
          lineCost,
        }
      })

      return NextResponse.json({
        cost: totalCost,
        ingredients: ingredientCosts,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Products error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
