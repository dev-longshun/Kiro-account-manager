import { useState, useEffect, useCallback } from 'react'
import { Button } from '../ui'
import { useAccountsStore } from '@/store/accounts'
import { X, Upload, Download, Trash2, KeyRound, Github, Eye, EyeOff, CheckSquare, Square, MinusSquare } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialCredential {
  id: string
  type: 'github' | 'google'
  name: string
  username: string
  password: string
  totpSecret?: string
  group?: string
  recoveryEmail?: string
}

interface SocialCredentialsDialogProps {
  isOpen: boolean
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Parse helpers (ported from plugin options.js)
// ---------------------------------------------------------------------------

function parseInput(text: string): Omit<SocialCredential, 'id'>[] {
  text = text.trim()
  if (!text) return []

  // JSON
  if (text.startsWith('[')) {
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data)) return data.map((a: Record<string, string>) => ({ ...a, type: a.type || 'github' } as Omit<SocialCredential, 'id'>))
    } catch { /* fall through */ }
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const accounts: Omit<SocialCredential, 'id'>[] = []

  for (const line of lines) {
    const parts = line.split('----').map(s => s.trim())
    if (parts.length === 3) {
      // GitHub: username----password----totpSecret
      accounts.push({ type: 'github', name: parts[0], username: parts[0], password: parts[1], totpSecret: parts[2] })
    } else if (parts.length === 5) {
      // Google: number----email----password----recoveryEmail----totpSecret
      accounts.push({ type: 'google', name: parts[1].split('@')[0], group: parts[0], username: parts[1], password: parts[2], recoveryEmail: parts[3], totpSecret: parts[4] })
    }
  }
  return accounts
}

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SocialCredentialsDialog({ isOpen, onClose }: SocialCredentialsDialogProps): React.ReactNode {
  const { accounts } = useAccountsStore()
  const [credentials, setCredentials] = useState<SocialCredential[]>([])
  const [inputText, setInputText] = useState('')
  const [preview, setPreview] = useState<Omit<SocialCredential, 'id'>[]>([])
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [filter, setFilter] = useState<'all' | 'github' | 'google'>('all')
  const [showPasswords, setShowPasswords] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Load credentials on open
  const loadCredentials = useCallback(async () => {
    const result = await window.api.loadSocialCredentials()
    if (result.success) setCredentials(result.credentials)
  }, [])

  useEffect(() => {
    if (isOpen) loadCredentials()
  }, [isOpen, loadCredentials])

  // Live preview
  useEffect(() => {
    const timer = setTimeout(() => setPreview(parseInput(inputText)), 300)
    return () => clearTimeout(timer)
  }, [inputText])

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  // Import
  const handleImport = async () => {
    if (!preview.length) { showMsg('error', '未识别到任何账号'); return }
    for (let i = 0; i < preview.length; i++) {
      if (!preview[i].username) { showMsg('error', `第 ${i + 1} 个账号缺少用户名`); return }
      if (!preview[i].password) { showMsg('error', `第 ${i + 1} 个账号缺少密码`); return }
    }
    const newCreds = preview.map(a => ({ ...a, id: generateId() }))
    const merged = importMode === 'append' ? [...credentials, ...newCreds] : newCreds
    const result = await window.api.saveSocialCredentials(merged)
    if (result.success) {
      setCredentials(merged)
      setInputText('')
      showMsg('success', `已${importMode === 'append' ? '追加' : '替换保存'} ${newCreds.length} 个凭据`)
    } else {
      showMsg('error', result.error || '保存失败')
    }
  }

  // Export JSON
  const handleExport = async () => {
    if (!credentials.length) { showMsg('error', '没有可导出的凭据'); return }
    const json = JSON.stringify(credentials, null, 2)
    const ok = await window.api.exportToFile(json, 'social-credentials.json')
    if (ok) showMsg('success', '导出成功')
  }

  // Delete single
  const handleDelete = async (id: string) => {
    const result = await window.api.deleteSocialCredential(id)
    if (result.success) {
      setCredentials(prev => prev.filter(c => c.id !== id))
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  // Batch delete
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    const remaining = credentials.filter(c => !selectedIds.has(c.id))
    const result = await window.api.saveSocialCredentials(remaining)
    if (result.success) {
      setCredentials(remaining)
      setSelectedIds(new Set())
      showMsg('success', `已删除 ${selectedIds.size} 个凭据`)
    } else {
      showMsg('error', result.error || '批量删除失败')
    }
  }

  // Check if credential already imported as account
  const isCredentialImported = (cred: SocialCredential): boolean => {
    const providerValue = cred.type === 'google' ? 'Google' : 'Github'
    return Array.from(accounts.values()).some(
      acc => acc.email === cred.username && acc.credentials.provider === providerValue
    )
  }

  const filtered = filter === 'all' ? credentials : credentials.filter(c => c.type === filter)

  // Clear selection on filter change
  const handleFilterChange = (value: 'all' | 'github' | 'google') => {
    setFilter(value)
    setSelectedIds(new Set())
  }

  // Select all / deselect all (within current filter)
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id))
  const someFilteredSelected = filtered.some(c => selectedIds.has(c.id))
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(c => next.delete(c.id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(c => next.add(c.id))
        return next
      })
    }
  }
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-lg shadow-xl w-[720px] max-h-[85vh] flex flex-col border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Social 凭据管理</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Message */}
          {message && (
            <div className={`px-3 py-2 rounded text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
              {message.text}
            </div>
          )}

          {/* Import area */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">批量导入</h3>
            <textarea
              className="w-full h-28 px-3 py-2 text-sm border rounded-md bg-muted/30 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={"GitHub: username----password----totpSecret\nGoogle: number----email----password----recoveryEmail----totpSecret\n或粘贴 JSON 数组"}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
            />
            {/* Preview */}
            {preview.length > 0 && (
              <div className="text-xs text-muted-foreground">
                识别到 {preview.length} 个账号：
                {preview.map((a, i) => (
                  <span key={i} className="ml-1">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${a.type === 'google' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {a.type === 'google' ? 'Google' : 'GitHub'}
                    </span>
                    <span className="ml-0.5">{a.username}</span>
                    {i < preview.length - 1 && '，'}
                  </span>
                ))}
              </div>
            )}
            {/* Import controls */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="importMode" checked={importMode === 'append'} onChange={() => setImportMode('append')} className="accent-primary" />
                追加
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="importMode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} className="accent-primary" />
                替换
              </label>
              <div className="flex-1" />
              <Button size="sm" onClick={handleImport} disabled={!preview.length}>
                <Upload className="h-3.5 w-3.5 mr-1" />导入
              </Button>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Existing credentials */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {filtered.length > 0 && (
                  <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground transition-colors" title={allFilteredSelected ? '取消全选' : '全选'}>
                    {allFilteredSelected ? <CheckSquare className="h-4 w-4" /> : someFilteredSelected ? <MinusSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  </button>
                )}
                <h3 className="text-sm font-medium">已保存凭据 ({credentials.length})</h3>
                {selectedIds.size > 0 && (
                  <Button variant="destructive" size="sm" className="h-6 text-xs px-2" onClick={handleBatchDelete}>
                    <Trash2 className="h-3 w-3 mr-1" />删除 ({selectedIds.size})
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Filter */}
                <select
                  className="text-xs border rounded px-2 py-1 bg-background"
                  value={filter}
                  onChange={e => handleFilterChange(e.target.value as 'all' | 'github' | 'google')}
                >
                  <option value="all">全部</option>
                  <option value="github">GitHub</option>
                  <option value="google">Google</option>
                </select>
                <Button variant="ghost" size="sm" onClick={() => setShowPasswords(!showPasswords)} title={showPasswords ? '隐藏密码' : '显示密码'}>
                  {showPasswords ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={!credentials.length}>
                  <Download className="h-3.5 w-3.5 mr-1" />导出
                </Button>
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {credentials.length ? '该分类下暂无凭据' : '暂无凭据，请先导入'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                {filtered.map((cred, i) => {
                  const imported = isCredentialImported(cred)
                  return (
                  <div key={cred.id} className="flex items-center gap-3 px-3 py-2 rounded-md border bg-muted/20 hover:bg-muted/40 text-sm group">
                    <button onClick={() => toggleSelect(cred.id)} className="text-muted-foreground hover:text-foreground shrink-0">
                      {selectedIds.has(cred.id) ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-muted-foreground w-5 text-right text-xs">{i + 1}</span>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${cred.type === 'google' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {cred.type === 'google' ? 'Google' : <span className="flex items-center gap-0.5"><Github className="h-2.5 w-2.5" />GitHub</span>}
                    </span>
                    <span className="truncate flex-1 font-mono">{cred.username}</span>
                    {imported && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 shrink-0">已存在</span>}
                    <span className="text-muted-foreground text-xs w-20 truncate">{showPasswords ? cred.password : '••••••'}</span>
                    <span className="text-muted-foreground text-xs w-8 text-center">{cred.totpSecret ? '2FA' : '-'}</span>
                    {cred.group && <span className="text-muted-foreground text-xs">{cred.group}</span>}
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => handleDelete(cred.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
