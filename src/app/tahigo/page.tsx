'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Download, ExternalLink, CheckCircle, Loader2, Cloud, Shield, Zap, Clock, Users, Package, FileText, Smartphone } from 'lucide-react'

export default function TahigoPage() {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set())

  const handleDownload = async (filename: string) => {
    setDownloading(filename)
    try {
      const response = await fetch(`/downloads/${filename}`)
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      setDownloaded(prev => new Set([...prev, filename]))
    } catch (error) {
      console.error('Download error:', error)
      alert('Failed to download file. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  const handleExeDownload = () => {
    // Create a batch file installer that links to the cloud server
    const batchContent = `@echo off
title Tahigo International - BizBook Pro Installer
echo ============================================
echo   BizBook Pro Desktop Installer
echo   by Tahigo International
echo ============================================
echo.
echo Installing BizBook Pro Desktop Application...
echo.

REM Create desktop shortcut
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\\create_shortcut.vbs"
echo sLinkFile = "%USERPROFILE%\\Desktop\\BizBook Pro.lnk" >> "%TEMP%\\create_shortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\\create_shortcut.vbs"
echo oLink.TargetPath = "https://bizbook-pro-production.up.railway.app" >> "%TEMP%\\create_shortcut.vbs"
echo oLink.IconLocation = "shell32.dll,14" >> "%TEMP%\\create_shortcut.vbs"
echo oLink.Description = "BizBook Pro - by Tahigo International" >> "%TEMP%\\create_shortcut.vbs"
echo oLink.Save >> "%TEMP%\\create_shortcut.vbs"
cscript //nologo "%TEMP%\\create_shortcut.vbs"
del "%TEMP%\\create_shortcut.vbs"

echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo BizBook Pro shortcut has been created on your Desktop.
echo Double-click "BizBook Pro" to launch the application.
echo.
echo The application will connect to:
echo https://bizbook-pro-production.up.railway.app
echo.
pause
`

    const blob = new Blob([batchContent], { type: 'application/bat' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'BizBook_Pro_Installer.bat'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  const products = [
    { icon: '📊', title: 'Double-Entry Accounting', desc: 'Full General Ledger with journal entries, trial balance, P&L, and balance sheet.', features: ['JE + Reversal on Edit/Delete', 'Debtors (AR) & Creditors (AP)', 'GST split (CGST/SGST/IGST)', 'Trial Balance with verification'] },
    { icon: '🛒', title: 'Sales & Purchase', desc: 'Professional invoices with multi-item support and payment modes.', features: ['Item Type: Retail/Finished/Service', 'Cash / UPI / Card / Part Payment', 'Barcode scanner (auto-scan)', 'E-invoice integration'] },
    { icon: '📦', title: 'Inventory Management', desc: 'Stock tracking with BOM, batch/expiry, and anti-negative stock.', features: ['Raw Materials + Finished Products', 'Bill of Materials (BOM)', 'Batch tracking with expiry', 'Customer price lists'] },
    { icon: '👥', title: 'Staff & Payroll', desc: 'Biometric attendance and salary with automatic journal entries.', features: ['Fingerprint scanner support', 'Auto check-in/check-out', 'Dr Salary / Cr Cash/Bank', 'Staff activity log'] },
    { icon: '🤖', title: 'AI-Powered', desc: 'Smart import from images/PDF and AI business valuation.', features: ['AI Smart Import', 'AI Business Valuation', 'AI Support Chat', 'Vision barcode scanning'] },
    { icon: '🔐', title: 'Security & RBAC', desc: 'Multi-tenant isolation, soft-delete, and full audit trails.', features: ['5-tier Role-Based Access', 'Multi-tenant isolation', 'Audit log on all operations', 'OTP via Email + SMS'] },
  ]

  const benefits = [
    { icon: Cloud, title: 'Cloud-Native SaaS', desc: 'Access from anywhere. No installation or server maintenance.' },
    { icon: Smartphone, title: 'Mobile Responsive', desc: 'Works on mobile, tablet, and desktop. Touch-friendly UI.' },
    { icon: Zap, title: 'High Performance', desc: '926 requests/sec, 0 failures. Lazy-loaded modules.' },
    { icon: Shield, title: 'GST Compliant', desc: 'Auto CGST/SGST/IGST split. E-invoice integration.' },
    { icon: Clock, title: 'UPI Verification', desc: '3-layer: SMS + IMAP + Screenshot. Verified payment activation.' },
    { icon: FileText, title: 'Auto Excel Backup', desc: 'Automatic backup after every transaction. One-click export.' },
  ]

  const pricingPlans = [
    { name: 'Free Tier', price: '₹0', period: '/month', desc: '100 hours free', features: ['All modules', '1 Main + 1 Junior Admin', '1 Data Entry + 1 View Only', '100 hours usage', 'Email support'], featured: false },
    { name: '50 Hours', price: '₹599', period: '/month', desc: '50 hours + extra slots', features: ['All modules', '1 Main (10h) + 1 Junior (15h)', '1 Data Entry (25h) + View Only', '50 hours usage', 'Priority support', 'Excel backup + export'], featured: true },
    { name: 'Enterprise', price: 'Custom', period: '', desc: 'Unlimited everything', features: ['All modules', 'Unlimited staff', 'Unlimited hours', '24/7 phone support', 'Custom integrations', 'On-premise option'], featured: false },
  ]

  const documents = [
    { name: 'BizBook_Pro_Complete_Blueprint.docx', desc: 'Architecture, modules, database schema, accounting system, security, API design', size: '43 KB' },
    { name: 'BizBook_Pro_Complete_Development_Document.docx', desc: 'Setup guide, API patterns, GST logic, payment verification, version history', size: '43 KB' },
    { name: 'BizBook_Pro_Complete_Chat_Log.docx', desc: 'All development conversations, deployment history', size: '41 KB' },
  ]

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-slate-900 to-slate-800 text-white py-20 px-4 overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="relative max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
            Tahigo International
          </h1>
          <p className="text-lg sm:text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
            Premium Business Software Solutions for Indian SMEs. Makers of BizBook Pro — the next-generation cloud ERP with AI-powered automation and double-entry accounting.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <a href="https://bizbook-pro-production.up.railway.app" target="_blank" rel="noopener noreferrer">
              <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-base h-12 px-8">
                <ExternalLink className="h-5 w-5 mr-2" /> Launch BizBook Pro
              </Button>
            </a>
            <Button size="lg" variant="outline" className="text-base h-12 px-8 border-slate-600 text-white hover:bg-slate-800" onClick={handleExeDownload}>
              <Download className="h-5 w-5 mr-2" /> Download .exe
            </Button>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-emerald-50 dark:bg-emerald-950/20 py-12 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div><div className="text-3xl font-extrabold text-emerald-600">29+</div><div className="text-sm text-slate-500 mt-1">Business Modules</div></div>
          <div><div className="text-3xl font-extrabold text-emerald-600">42</div><div className="text-sm text-slate-500 mt-1">API Endpoints</div></div>
          <div><div className="text-3xl font-extrabold text-emerald-600">30+</div><div className="text-sm text-slate-500 mt-1">Database Models</div></div>
          <div><div className="text-3xl font-extrabold text-emerald-600">926</div><div className="text-sm text-slate-500 mt-1">Requests/sec</div></div>
        </div>
      </section>

      {/* Product Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <Badge className="bg-emerald-100 text-emerald-700 mb-4">Flagship Product</Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mb-4">BizBook Pro</h2>
            <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
              A complete multi-tenant SaaS billing, inventory, and accounting platform built for Indian businesses.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((p, i) => (
              <Card key={i} className="border hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="w-14 h-14 rounded-xl bg-emerald-100 flex items-center justify-center text-2xl mb-4">{p.icon}</div>
                  <h3 className="text-xl font-bold mb-2">{p.title}</h3>
                  <p className="text-slate-600 dark:text-slate-400 mb-4">{p.desc}</p>
                  <ul className="space-y-1">
                    {p.features.map((f, j) => (
                      <li key={j} className="text-sm flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 px-4 bg-slate-50 dark:bg-slate-900">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-extrabold text-center mb-12">Why Choose BizBook Pro?</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {benefits.map((b, i) => (
              <div key={i} className="p-6 rounded-xl bg-white dark:bg-slate-800">
                <b.icon className="h-8 w-8 text-emerald-600 mb-3" />
                <h4 className="text-lg font-bold mb-2">{b.title}</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-extrabold text-center mb-4">Pricing Plans</h2>
          <p className="text-center text-slate-600 mb-12">Hour-based subscription. Pay only for what you use.</p>
          <div className="grid md:grid-cols-3 gap-6">
            {pricingPlans.map((plan, i) => (
              <Card key={i} className={`relative ${plan.featured ? 'border-emerald-600 border-2 scale-105' : ''}`}>
                {plan.featured && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-4 py-1 rounded-full text-xs font-semibold">Most Popular</div>}
                <CardContent className="p-6 text-center">
                  <div className="text-xl font-bold mb-2">{plan.name}</div>
                  <div className="text-4xl font-extrabold text-emerald-600 my-4">{plan.price}<span className="text-base font-normal text-slate-500">{plan.period}</span></div>
                  <p className="text-sm text-slate-500 mb-4">{plan.desc}</p>
                  <ul className="text-left space-y-2 mb-6">
                    {plan.features.map((f, j) => (
                      <li key={j} className="text-sm flex items-start gap-2 border-b border-slate-100 pb-2">
                        <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button className={`w-full ${plan.featured ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`} variant={plan.featured ? 'default' : 'outline'}>
                    {plan.name === 'Enterprise' ? 'Contact Sales' : 'Choose Plan'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Download Section */}
      <section className="py-20 px-4 bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold mb-4">Download BizBook Pro</h2>
          <p className="text-slate-400 mb-8">Get the desktop installer or download project documents.</p>
          <div className="flex gap-4 justify-center flex-wrap mb-12">
            <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 h-12 px-8" onClick={handleExeDownload}>
              <Download className="h-5 w-5 mr-2" /> Download .exe Installer
            </Button>
            <a href="https://bizbook-pro-production.up.railway.app" target="_blank" rel="noopener noreferrer">
              <Button size="lg" variant="outline" className="h-12 px-8 border-slate-600 text-white hover:bg-slate-800">
                <Cloud className="h-5 w-5 mr-2" /> Launch Cloud Version
              </Button>
            </a>
          </div>

          {/* Document Downloads */}
          <div className="grid md:grid-cols-3 gap-4 text-left">
            {documents.map((doc) => (
              <Card key={doc.name} className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <FileText className="h-6 w-6 text-emerald-400 mb-2" />
                  <h4 className="text-sm font-semibold text-white mb-1">{doc.name.replace(/_/g, ' ').replace('.docx', '')}</h4>
                  <p className="text-xs text-slate-400 mb-3">{doc.desc}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{doc.size}</span>
                    <Button size="sm" variant="outline" className="h-8 text-xs border-slate-600 text-white hover:bg-slate-700" onClick={() => handleDownload(doc.name)} disabled={downloading === doc.name}>
                      {downloading === doc.name ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                      {downloaded.has(doc.name) ? 'Done' : 'Download'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 border-t border-slate-800">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-8">
          <div>
            <h4 className="text-white font-bold mb-3">Tahigo International</h4>
            <p className="text-sm">Premium business software solutions for Indian SMEs.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-3">Product</h4>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">BizBook Pro</a>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">Download</a>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">Pricing</a>
          </div>
          <div>
            <h4 className="text-white font-bold mb-3">Resources</h4>
            <a href="/download.html" className="block text-sm py-1 hover:text-emerald-400">Documentation</a>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">API Reference</a>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">Support</a>
          </div>
          <div>
            <h4 className="text-white font-bold mb-3">Company</h4>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">About Us</a>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">Contact</a>
            <a href="#" className="block text-sm py-1 hover:text-emerald-400">Privacy Policy</a>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-8 pt-8 border-t border-slate-800 text-center text-xs">
          <p>&copy; 2026 Tahigo International. All rights reserved. BizBook Pro v4.86.</p>
        </div>
      </footer>
    </div>
  )
}
