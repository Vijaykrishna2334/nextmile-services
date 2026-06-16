/*
  NextMile Hub — Slice 1 (Auth + Dashboard + WhatsApp Review)

  HOW TO USE:
  1. Create a brand new Lovable project called "NextMile Hub"
  2. In Lovable, replace src/App.tsx with this file's contents (rename to App.tsx)
  3. Lovable will auto-install dependencies and live-render
  4. Set the API base URL: in Lovable Settings > Environment, add VITE_API_BASE=https://api.gonextmile.live
     (or paste the value directly in line 1 of CONFIG below for quick testing)

  Tech: React + Tailwind + shadcn/ui. Lovable auto-supports all three.
*/

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast, Toaster } from 'sonner'
import { LogOut, MessageSquare, AlertCircle, CheckCircle2, Clock, Copy, RefreshCw } from 'lucide-react'

const CONFIG = {
  apiBase: import.meta.env.VITE_API_BASE || 'https://api.gonextmile.live',
}

interface WhatsAppLog {
  _id: string
  fullPhone: string
  customerName: string
  messageText: string
  classification: 'generic' | 'order-specific' | 'sensitive' | 'order-lookup'
  status: 'auto-replied' | 'flagged' | 'reviewed' | 'failed'
  botReply: string
  suggestedReply: string
  orderRecordsSnapshot: Array<Record<string, unknown>>
  createdAt: string
}

interface DashStats { total: number; autoReplied: number; flagged: number; failed: number }

function useAuthToken() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('nm-hub-token'))
  const save = (t: string | null) => {
    if (t) { localStorage.setItem('nm-hub-token', t); setToken(t) }
    else   { localStorage.removeItem('nm-hub-token'); setToken(null) }
  }
  return [token, save] as const
}

async function api<T>(path: string, opts: { method?: string; body?: object; token?: string | null } = {}): Promise<T> {
  const res = await fetch(`${CONFIG.apiBase}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const data = await api<{ token: string }>('/api/ops/login', { method: 'POST', body: { email, password } })
      onLogin(data.token)
      toast.success('Welcome back')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-4">
      <Card className="w-full max-w-md bg-slate-900/80 backdrop-blur border-slate-800">
        <CardHeader>
          <CardTitle className="text-2xl bg-gradient-to-r from-slate-100 to-indigo-300 bg-clip-text text-transparent">
            NextMile Hub
          </CardTitle>
          <p className="text-sm text-slate-400">Admin sign-in</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="bg-slate-800/50 border-slate-700 text-slate-100"/>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="bg-slate-800/50 border-slate-700 text-slate-100"/>
            </div>
            <Button type="submit" disabled={busy} className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon, label, value, accent }: { icon: ReactNode; label: string; value: number | string; accent: string }) {
  return (
    <Card className="bg-slate-900/70 backdrop-blur border-slate-800 hover:border-slate-700 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">{label}</p>
            <p className="text-3xl font-bold mt-2 text-slate-100">{value}</p>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${accent}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Dashboard({ token }: { token: string }) {
  const [stats, setStats] = useState<DashStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try { setStats(await api('/api/ops/whatsapp/stats/today', { token })) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load stats') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-100">Today's activity</h2>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`}/> Refresh
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<MessageSquare className="w-6 h-6 text-indigo-300"/>} label="Total messages" value={stats?.total ?? '—'} accent="bg-indigo-500/20"/>
        <StatCard icon={<CheckCircle2 className="w-6 h-6 text-emerald-300"/>} label="Auto-replied" value={stats?.autoReplied ?? '—'} accent="bg-emerald-500/20"/>
        <StatCard icon={<AlertCircle className="w-6 h-6 text-amber-300"/>} label="Flagged for review" value={stats?.flagged ?? '—'} accent="bg-amber-500/20"/>
        <StatCard icon={<Clock className="w-6 h-6 text-rose-300"/>} label="Failed" value={stats?.failed ?? '—'} accent="bg-rose-500/20"/>
      </div>
    </div>
  )
}

const CLASS_BADGE: Record<WhatsAppLog['classification'], { label: string; cls: string }> = {
  'generic':        { label: 'Generic',        cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  'order-lookup':   { label: 'Order lookup',   cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  'order-specific': { label: 'Order-specific', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  'sensitive':      { label: 'Sensitive',      cls: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
}

function WhatsAppReview({ token }: { token: string }) {
  const [items, setItems] = useState<WhatsAppLog[]>([])
  const [view, setView]   = useState<'flagged' | 'recent'>('flagged')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api<{ items: WhatsAppLog[] }>(`/api/ops/whatsapp/${view}`, { token })
      setItems(data.items)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load chats') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [view])

  const markReviewed = async (id: string) => {
    try {
      await api(`/api/ops/whatsapp/${id}/reviewed`, { method: 'POST', token })
      toast.success('Marked reviewed')
      setItems(prev => prev.filter(x => x._id !== id))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={view} onValueChange={(v) => setView(v as 'flagged' | 'recent')}>
          <TabsList className="bg-slate-900 border border-slate-800">
            <TabsTrigger value="flagged" className="data-[state=active]:bg-slate-800">Needs review</TabsTrigger>
            <TabsTrigger value="recent"  className="data-[state=active]:bg-slate-800">All recent</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}
          className="border-slate-700 text-slate-300 hover:bg-slate-800">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`}/> Refresh
        </Button>
      </div>

      {items.length === 0 && !loading && (
        <Card className="bg-slate-900/70 border-slate-800">
          <CardContent className="p-8 text-center text-slate-400">
            {view === 'flagged' ? 'No chats need review right now 🎉' : 'No recent messages yet.'}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {items.map(it => {
          const badge = CLASS_BADGE[it.classification]
          return (
            <Card key={it._id} className="bg-slate-900/70 backdrop-blur border-slate-800 hover:border-slate-700 transition-colors">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-slate-100">{it.customerName || 'Unknown'}</p>
                      <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
                      <span className="text-xs text-slate-500 font-mono">{it.fullPhone}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(it.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="outline" className={
                    it.status === 'auto-replied' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                    it.status === 'flagged'      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                    it.status === 'failed'       ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                    'bg-slate-500/20 text-slate-300 border-slate-500/30'
                  }>{it.status}</Badge>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Customer wrote</p>
                  <p className="text-slate-200 bg-slate-800/40 rounded-lg p-3 text-sm">{it.messageText}</p>
                </div>

                {it.orderRecordsSnapshot && it.orderRecordsSnapshot.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Order(s) on file</p>
                    <div className="space-y-1">
                      {it.orderRecordsSnapshot.map((o, i) => (
                        <div key={i} className="text-xs bg-slate-800/40 rounded-lg p-2 font-mono text-slate-300">
                          {[o.orderId, o.product, o.deliveryStatus, o.awb].filter(Boolean).join(' · ')}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(it.botReply || it.suggestedReply) && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                      {it.botReply ? 'Bot sent' : 'Suggested reply'}
                    </p>
                    <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-sm text-slate-200 flex items-start justify-between gap-3">
                      <p className="flex-1 whitespace-pre-wrap">{it.botReply || it.suggestedReply}</p>
                      <Button size="sm" variant="ghost" onClick={() => copyText(it.botReply || it.suggestedReply)}
                        className="text-indigo-300 hover:bg-indigo-500/10">
                        <Copy className="w-4 h-4"/>
                      </Button>
                    </div>
                  </div>
                )}

                {it.status === 'flagged' && (
                  <div className="flex justify-end">
                    <Button onClick={() => markReviewed(it._id)} className="bg-emerald-600 hover:bg-emerald-700">
                      Mark reviewed
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useAuthToken()
  const [me, setMe] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setMe(null); return }
    api<{ email: string }>('/api/ops/me', { token })
      .then(d => setMe(d.email))
      .catch(() => setToken(null))
  }, [token])

  if (!token || !me) return <><LoginScreen onLogin={setToken}/><Toaster theme="dark" position="top-right"/></>

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <header className="border-b border-slate-800 bg-slate-950/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center font-bold text-white">N</div>
            <div>
              <p className="font-bold text-slate-100">NextMile Hub</p>
              <p className="text-xs text-slate-400">{me}</p>
            </div>
          </div>
          <Button variant="ghost" onClick={() => setToken(null)} className="text-slate-400 hover:text-slate-100 hover:bg-slate-800">
            <LogOut className="w-4 h-4 mr-2"/> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="bg-slate-900 border border-slate-800">
            <TabsTrigger value="dashboard" className="data-[state=active]:bg-slate-800">Dashboard</TabsTrigger>
            <TabsTrigger value="whatsapp"  className="data-[state=active]:bg-slate-800">WhatsApp Review</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard"><Dashboard token={token}/></TabsContent>
          <TabsContent value="whatsapp"><WhatsAppReview token={token}/></TabsContent>
        </Tabs>
      </main>

      <Toaster theme="dark" position="top-right"/>
    </div>
  )
}
