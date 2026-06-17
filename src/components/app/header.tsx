'use client'

import { useAppStore, type DateFilterType } from '@/store/app-store'
import { Search, Calendar, Download, Filter } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar as CalendarComponent } from '@/components/ui/calendar'
import { format } from 'date-fns'
import { exportToExcel } from '@/lib/excel-export'
import { useState } from 'react'

const dateFilterOptions: { value: DateFilterType; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year', label: 'This Year' },
  { value: 'custom', label: 'Custom' },
]

interface HeaderProps {
  title: string
  data?: Record<string, unknown>[]
  exportFileName?: string
  exportSheetName?: string
}

export function AppHeader({ title, data, exportFileName, exportSheetName }: HeaderProps) {
  const { dateFilter, setDateFilter, searchQuery, setSearchQuery } = useAppStore()
  const [showFilters, setShowFilters] = useState(false)

  const currentFilterLabel = dateFilterOptions.find(f => f.value === dateFilter.type)?.label || 'All Time'

  return (
    <div className="border-b bg-card">
      {/* Main header row */}
      <div className="flex items-center justify-between gap-2 p-3 sm:p-4">
        <h2 className="text-lg font-semibold truncate">{title}</h2>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Search — hidden on very small screens */}
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 w-48"
            />
          </div>

          {/* Mobile search — icon only, expands on focus */}
          <div className="relative sm:hidden">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 w-36 text-sm"
            />
          </div>

          {/* Date filter toggle button */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs gap-1"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{currentFilterLabel}</span>
          </Button>

          {/* Excel Export */}
          {data && data.length > 0 && exportFileName && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50"
              onClick={() => exportToExcel(data, exportFileName, exportSheetName || 'Sheet1')}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline ml-1">Excel</span>
            </Button>
          )}
        </div>
      </div>

      {/* Date filter row — collapsible */}
      {showFilters && (
        <div className="px-3 sm:px-4 pb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {dateFilterOptions.map((opt) => (
              <Button
                key={opt.value}
                variant={dateFilter.type === opt.value ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setDateFilter({ type: opt.value })
                  if (opt.value !== 'custom') setShowFilters(false)
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {/* Custom Date Pickers */}
          {dateFilter.type === 'custom' && (
            <div className="flex items-center gap-2 flex-wrap">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    <Calendar className="h-3 w-3 mr-1" />
                    {dateFilter.startDate ? format(new Date(dateFilter.startDate), 'dd/MM/yy') : 'From'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateFilter.startDate ? new Date(dateFilter.startDate) : undefined}
                    onSelect={(date) =>
                      setDateFilter({ ...dateFilter, startDate: date?.toISOString() })
                    }
                  />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    <Calendar className="h-3 w-3 mr-1" />
                    {dateFilter.endDate ? format(new Date(dateFilter.endDate), 'dd/MM/yy') : 'To'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateFilter.endDate ? new Date(dateFilter.endDate) : undefined}
                    onSelect={(date) =>
                      setDateFilter({ ...dateFilter, endDate: date?.toISOString() })
                    }
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
