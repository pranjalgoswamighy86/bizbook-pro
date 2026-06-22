'use client'

/**
 * Help & Support — In-App AI Chat (v4.63)
 * ========================================
 * Replaces the "Contact Support" tab with an AI-powered chat agent.
 * The AI understands the user's query, optimizes it, and saves it
 * to the HelpSupportTicket table for admin review.
 *
 * Flow:
 *   1. User types their question/issue
 *   2. AI analyzes and provides an instant answer
 *   3. AI optimizes the query (summarizes, categorizes, adds context)
 *   4. The optimized query + AI response are saved as a ticket
 *   5. Super Admin sees all tickets in the Help & Support Management panel
 */

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Send, Sparkles, MessageCircle, ChevronDown, ChevronRight, HelpCircle, Mail, Phone, BookOpen, Lightbulb } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface ChatMessage {
  role: 'user' | 'ai'
  content: string
  timestamp: string
}

export function HelpChatTab({ userEmail, tenantName }: { userEmail?: string; tenantName?: string }) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'ai',
      content: 'Hi! I\'m your BizBook Pro AI assistant. How can I help you today? You can ask about registration, OTP, payments, inventory, invoices, or any other issue.',
      timestamp: new Date().toISOString(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage: ChatMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const res = await authFetch('/api/help-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input.trim(),
          userEmail,
          tenantName,
          history: messages.slice(-5), // last 5 messages for context
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to get response')
      }

      const data = await res.json()
      const aiMessage: ChatMessage = {
        role: 'ai',
        content: data.response || 'I apologize, I couldn\'t process your request. Please try rephrasing your question.',
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, aiMessage])

      // Show toast if ticket was created
      if (data.ticketCreated) {
        toast({
          title: 'Support ticket created',
          description: 'Your query has been forwarded to the admin team.',
          duration: 5000,
        })
      }
    } catch (err: any) {
      const errorMessage: ChatMessage = {
        role: 'ai',
        content: 'I\'m having trouble connecting right now. Please try again in a moment, or contact support directly at pranjalgoswamighy86@gmail.com or +91 91015 55075.',
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-[400px] sm:h-[450px]">
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-2 sm:p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] sm:max-w-[75%] px-3 py-2 rounded-lg text-xs sm:text-sm ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white rounded-br-none'
                  : 'bg-white dark:bg-slate-800 border rounded-bl-none'
              }`}
            >
              {msg.role === 'ai' && (
                <div className="flex items-center gap-1 mb-1 text-[10px] sm:text-xs text-emerald-600 font-semibold">
                  <Sparkles className="h-3 w-3" />
                  AI Assistant
                </div>
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-emerald-100' : 'text-muted-foreground'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-slate-800 border rounded-lg rounded-bl-none px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 mt-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your question..."
          disabled={loading}
          className="text-sm"
        />
        <Button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 flex-shrink-0"
          size="icon"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {/* Quick suggestions */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {['How to register?', 'OTP not received', 'How to buy a plan?', 'Payment not verified'].map(q => (
            <button
              key={q}
              onClick={() => setInput(q)}
              className="text-[11px] px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-full transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
