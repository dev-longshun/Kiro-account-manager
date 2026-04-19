import { useState, useEffect, useCallback } from 'react'
import { Button } from '../ui'
import { useAccountsStore } from '@/store/accounts'
import { X, Upload, Download, Trash2, KeyRound, Github, Eye, EyeOff, CheckSquare, Square, MinusSquare } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialCredential {
  id: string
  type: 'github' | 'google' | 'enterprise'
  name: string
  username: string
  password: string
  newPassword?: string // 自动登录时系统生成的新密码
  totpSecret?: string
  group?: string
  recoveryEmail?: string
  startUrl?: string
  region?: string
}

interface SocialCredentialsDialogProps {
  isOpen: boolean
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Import format types
// ---------------------------------------------------------------------------

type ImportFormat = 'auto' | 'github' | 'google' | 'enterprise' | 'enterprise-sso'

const IMPORT_FORMATS: { value: ImportFormat; label: string; placeholder: string }[] = [
  {
    value: 'auto',
    label: '自动识别',
    placeholder: 'GitHub: username----password----totpSecret\nGoogle: number----email----password----recoveryEmail----totpSecret\nEnterprise: startUrl----region----name----username----password----totpSecret\n或粘贴 JSON 数组',
  },
  {
    value: 'github',
    label: 'GitHub',
    placeholder: 'username----password----totpSecret\n每行一个账号',
  },
  {
    value: 'google',
    label: 'Google',
    placeholder: 'number----email----password----recoveryEmail----totpSecret\n每行一个账号',
  },
  {
    value: 'enterprise',
    label: 'Enterprise',
    placeholder: 'startUrl----region----name----username----password----totpSecret\n每行一个账号',
  },
  {
    value: 'enterprise-sso',
    label: 'Enterprise SSO',
    placeholder: '直接粘贴原始凭据文本，支持批量（空行分隔多个账号）：\n\n默认 AWS access portal URL（仅限 IPv4）: https://d-xxx.awsapps.com/start\n双栈 AWS access portal URL: https://ssoins-xxx.portal.us-east-1.app.aws\n用户名: f47\n一次性密码: dsC%3PH6',
  },
]

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseInput(text: string, format: ImportFormat = 'auto'): Omit<SocialCredential, 'id'>[] {
  text = text.trim()
  if (!text) return []

  // 指定格式时走专用解析器
  if (format === 'enterprise-sso') return parseEnterpriseSso(text)
  if (format === 'github') return parseDelimited(text, 'github')
  if (format === 'google') return parseDelimited(text, 'google')
  if (format === 'enterprise') return parseDelimited(text, 'enterprise')

  // auto: JSON
  if (text.startsWith('[')) {
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data)) return data.map((a: Record<string, string>) => ({ ...a, type: a.type || 'github' } as Omit<SocialCredential, 'id'>))
    } catch { /* fall through */ }
  }

  // auto: ---- 分隔格式（自动检测类型）
  const accounts = parseDelimited(text, 'auto')

  // auto: 如果严格模式没识别到，尝试自然语言智能解析
  if (accounts.length === 0) {
    const nlAccounts = parseNaturalLanguage(text)
    if (nlAccounts.length > 0) return nlAccounts
  }

  return accounts
}

/** ---- 分隔格式解析 */
function parseDelimited(text: string, mode: 'auto' | 'github' | 'google' | 'enterprise'): Omit<SocialCredential, 'id'>[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const accounts: Omit<SocialCredential, 'id'>[] = []

  for (const line of lines) {
    const parts = line.split('----').map(s => s.trim())
    if ((mode === 'auto' || mode === 'github') && parts.length === 3) {
      accounts.push({ type: 'github', name: parts[0], username: parts[0], password: parts[1], totpSecret: parts[2] })
    } else if ((mode === 'auto' || mode === 'google') && parts.length === 5) {
      accounts.push({ type: 'google', name: parts[1].split('@')[0], group: parts[0], username: parts[1], password: parts[2], recoveryEmail: parts[3], totpSecret: parts[4] })
    } else if ((mode === 'auto' || mode === 'enterprise') && parts.length === 6) {
      accounts.push({ type: 'enterprise', name: parts[2], username: parts[3], password: parts[4], totpSecret: parts[5] || undefined, startUrl: parts[0], region: parts[1] })
    }
  }

  return accounts
}

/**
 * Enterprise SSO 强识别解析器
 *
 * 支持格式：
 *   默认 AWS access portal URL（仅限 IPv4）: https://d-xxx.awsapps.com/start
 *   双栈 AWS access portal URL: https://ssoins-xxx.portal.us-east-1.app.aws
 *   用户名: f47
 *   一次性密码: dsC%3PH6
 *
 * 多个账号之间用空行分隔
 */
function parseEnterpriseSso(text: string): Omit<SocialCredential, 'id'>[] {
  const accounts: Omit<SocialCredential, 'id'>[] = []

  // 按连续空行切分成多个账号块
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim())

  for (const block of blocks) {
    // 提取 awsapps.com/start URL（IPv4 默认 URL）
    const urlMatch = block.match(/https?:\/\/[^\s]+\.awsapps\.com\/start\S*/i)
    // 提取用户名（支持中英文标签）
    const userMatch = block.match(/(?:用户名|User(?:name)?)\s*[：:]\s*(\S+)/i)
    // 提取密码（支持"一次性密码"、"密码"、"Password"）
    const pwdMatch = block.match(/(?:一次性密码|密码|Password)\s*[：:]\s*(\S+)/i)
    // 可选：MFA / TOTP
    const mfaMatch = block.match(/(?:MFA|TOTP|验证码)\s*[：:]\s*([A-Z2-7=]+)/i)

    if (urlMatch && userMatch && pwdMatch) {
      const startUrl = urlMatch[0].replace(/[，,、；;]+$/, '')
      const username = userMatch[1]
      const password = pwdMatch[1]
      const totpSecret = mfaMatch ? mfaMatch[1] : undefined

      accounts.push({
        type: 'enterprise',
        name: username,
        username,
        password,
        totpSecret,
        startUrl,
        region: 'us-east-1',
      })
    }
  }

  return accounts
}

/**
 * 自然语言智能解析（auto 模式回退）：从粘贴的原始文本中提取 Enterprise SSO 凭据
 *
 * 支持格式示例：
 *   Your AWS access portal URL:
 *   https://d-906607ab48.awsapps.com/start
 *   User：xxx@hotmail.com
 *   Password：aws196S.
 *   MFA：JLXZZ7EL362LJO6EZWWVS36RIWKRDASA
 */
function parseNaturalLanguage(text: string): Omit<SocialCredential, 'id'>[] {
  const accounts: Omit<SocialCredential, 'id'>[] = []

  const urlPattern = /https?:\/\/[^\s]+\.awsapps\.com\/start\S*/gi
  const urlMatches = [...text.matchAll(urlPattern)]

  if (urlMatches.length === 0) return accounts

  for (let i = 0; i < urlMatches.length; i++) {
    const blockStart = urlMatches[i].index!
    const blockEnd = i + 1 < urlMatches.length ? urlMatches[i + 1].index! : text.length
    const block = text.slice(blockStart, blockEnd)
    const startUrl = urlMatches[i][0].replace(/[，,、；;]+$/, '')

    const userMatch = block.match(/(?:用户名|User(?:name)?)\s*[：:]\s*(\S+)/i)
    const passwordMatch = block.match(/(?:一次性密码|密码|Password)\s*[：:]\s*(\S+)/i)
    const mfaMatch = block.match(/(?:MFA|TOTP|验证码)\s*[：:]\s*([A-Z2-7=]+)/i)

    if (userMatch && passwordMatch) {
      const username = userMatch[1]
      const password = passwordMatch[1]
      const totpSecret = mfaMatch ? mfaMatch[1] : undefined

      accounts.push({
        type: 'enterprise',
        name: username.split('@')[0],
        username,
        password,
        totpSecret,
        startUrl,
        region: 'us-east-1',
      })
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
  const [importFormat, setImportFormat] = useState<ImportFormat>('auto')
  const [preview, setPreview] = useState<Omit<SocialCredential, 'id'>[]>([])
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [showPasswords, setShowPasswords] = useState<Record<string, { initial?: boolean; newPwd?: boolean }>>({})
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
    const timer = setTimeout(() => setPreview(parseInput(inputText, importFormat)), 300)
    return () => clearTimeout(timer)
  }, [inputText, importFormat])

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
    const providerValue = cred.type === 'google' ? 'Google' : cred.type === 'enterprise' ? 'Enterprise' : 'Github'
    return Array.from(accounts.values()).some(
      acc => acc.email === cred.username && acc.credentials.provider === providerValue
    )
  }

  // 筛选逻辑跟随 importFormat 联动
  const credentialFilter = importFormat === 'auto' ? 'all'
    : importFormat === 'github' ? 'github'
    : importFormat === 'google' ? 'google'
    : 'enterprise' // enterprise 和 enterprise-sso 都显示 enterprise 类型
  const filtered = credentialFilter === 'all' ? credentials : credentials.filter(c => c.type === credentialFilter)

  // Clear selection on format change
  useEffect(() => {
    setSelectedIds(new Set())
  }, [importFormat])

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

  const togglePwdVisibility = (id: string, field: 'initial' | 'newPwd') => {
    setShowPasswords(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: !prev[id]?.[field] }
    }))
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
            <h2 className="text-lg font-semibold">凭据管理</h2>
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">批量导入</h3>
              <div className="flex items-center gap-1.5">
                {IMPORT_FORMATS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setImportFormat(f.value)}
                    className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                      importFormat === f.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="w-full h-28 px-3 py-2 text-sm border rounded-md bg-muted/30 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={IMPORT_FORMATS.find(f => f.value === importFormat)?.placeholder}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
            />
            {/* Preview */}
            {preview.length > 0 && (
              <div className="text-xs text-muted-foreground">
                识别到 {preview.length} 个账号：
                {preview.map((a, i) => (
                  <span key={i} className="ml-1">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${a.type === 'google' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : a.type === 'enterprise' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {a.type === 'google' ? 'Google' : a.type === 'enterprise' ? 'Enterprise' : 'GitHub'}
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
                <h3 className="text-sm font-medium">
                  已保存凭据 ({filtered.length}{credentialFilter !== 'all' ? `/${credentials.length}` : ''})
                </h3>
                {selectedIds.size > 0 && (
                  <Button variant="destructive" size="sm" className="h-6 text-xs px-2" onClick={handleBatchDelete}>
                    <Trash2 className="h-3 w-3 mr-1" />删除 ({selectedIds.size})
                  </Button>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={!credentials.length}>
                <Download className="h-3.5 w-3.5 mr-1" />导出
              </Button>
            </div>
            {filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {credentials.length ? '该分类下暂无凭据' : '暂无凭据，请先导入'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                {filtered.map((cred, i) => {
                  const imported = isCredentialImported(cred)
                  const pwdState = showPasswords[cred.id] || {}
                  return (
                  <div key={cred.id} className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/20 hover:bg-muted/40 text-sm group">
                    <button onClick={() => toggleSelect(cred.id)} className="text-muted-foreground hover:text-foreground shrink-0">
                      {selectedIds.has(cred.id) ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-muted-foreground w-5 text-right text-xs shrink-0">{i + 1}</span>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${cred.type === 'google' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : cred.type === 'enterprise' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {cred.type === 'google' ? 'Google' : cred.type === 'enterprise' ? 'Enterprise' : <span className="flex items-center gap-0.5"><Github className="h-2.5 w-2.5" />GitHub</span>}
                    </span>
                    <span className="truncate flex-1 font-mono min-w-0">{cred.username}</span>
                    {imported && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 shrink-0">已存在</span>}
                    {/* 初始密码 */}
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-muted-foreground">初始</span>
                      <span className="text-muted-foreground text-xs w-16 truncate font-mono">{pwdState.initial ? cred.password : '••••••'}</span>
                      <button onClick={() => togglePwdVisibility(cred.id, 'initial')} className="text-muted-foreground hover:text-foreground">
                        {pwdState.initial ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                    {/* 新密码（仅在有值时显示） */}
                    {cred.newPassword && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-green-600 dark:text-green-400">新</span>
                        <span className="text-green-600 dark:text-green-400 text-xs w-16 truncate font-mono">{pwdState.newPwd ? cred.newPassword : '••••••'}</span>
                        <button onClick={() => togglePwdVisibility(cred.id, 'newPwd')} className="text-muted-foreground hover:text-foreground">
                          {pwdState.newPwd ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                      </div>
                    )}
                    <span className="text-muted-foreground text-xs w-6 text-center shrink-0">{cred.totpSecret ? '2FA' : '-'}</span>
                    {cred.startUrl && <span className="text-muted-foreground text-[10px] truncate max-w-[80px] shrink-0" title={cred.startUrl}>{cred.region || 'us-east-1'}</span>}
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0" onClick={() => handleDelete(cred.id)}>
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
