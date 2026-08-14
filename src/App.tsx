import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Sector
} from 'recharts'
import { apiPost, apiGet } from './api'

// ─── Types ───────────────────────────────────────────────────────────────────
type Screen =
  | 'login'
  | 'consent'
  | 'home'
  | 'registration'
  | 'attendance'
  | 'mood'
  | 'reports'
  | 'report-detail'
  | 'students'
  | 'student-detail'
  | 'settings'

type NavTab = 'home' | 'students' | 'monitor' | 'reports' | 'settings'

// ─── Mock Data ────────────────────────────────────────────────────────────────
const STUDENTS = [
  { id: 1, name: 'Amara Diallo', initials: 'AD', hue: 210, attendancePct: 94, engagementAvg: 82, trend: 'up', flag: false, moods: ['Focused', 'Focused', 'Curious', 'Focused', 'Calm'] },
  { id: 2, name: 'Ben Hartwell', initials: 'BH', hue: 155, attendancePct: 88, engagementAvg: 67, trend: 'down', flag: true, moods: ['Distracted', 'Sleepy', 'Calm', 'Distracted', 'Focused'] },
  { id: 3, name: 'Cleo Nakamura', initials: 'CN', hue: 280, attendancePct: 97, engagementAvg: 91, trend: 'up', flag: false, moods: ['Focused', 'Curious', 'Focused', 'Calm', 'Focused'] },
  { id: 4, name: 'Dani Osei', initials: 'DO', hue: 30, attendancePct: 79, engagementAvg: 58, trend: 'down', flag: true, moods: ['Sleepy', 'Distracted', 'Sleepy', 'Calm', 'Distracted'] },
  { id: 5, name: 'Elena Rossi', initials: 'ER', hue: 340, attendancePct: 92, engagementAvg: 75, trend: 'stable', flag: false, moods: ['Calm', 'Focused', 'Distracted', 'Calm', 'Focused'] },
  { id: 6, name: 'Finn Adeyemi', initials: 'FA', hue: 190, attendancePct: 85, engagementAvg: 70, trend: 'up', flag: false, moods: ['Focused', 'Calm', 'Curious', 'Focused', 'Calm'] },
  { id: 7, name: 'Grace Winters', initials: 'GW', hue: 120, attendancePct: 100, engagementAvg: 88, trend: 'up', flag: false, moods: ['Focused', 'Curious', 'Focused', 'Curious', 'Focused'] },
  { id: 8, name: 'Hiro Tanaka', initials: 'HT', hue: 50, attendancePct: 72, engagementAvg: 52, trend: 'down', flag: true, moods: ['Sleepy', 'Sleepy', 'Distracted', 'Sleepy', 'Calm'] },
]

const SESSION_TIMELINE = [
  { t: '9:00', engagement: 72 },
  { t: '9:10', engagement: 78 },
  { t: '9:20', engagement: 85 },
  { t: '9:30', engagement: 80 },
  { t: '9:40', engagement: 74 },
  { t: '9:50', engagement: 82 },
  { t: '10:00', engagement: 88 },
]

// attentiveness: attentive, focused, distracted, looking_away, sleepy, yawning
// mood: happy, sad, angry, furrowed, confused, surprised, fearful, neutral
const ATTENTION_COLORS: Record<string, string> = {
  Attentive: '#5bb8a0',
  Focused: '#3d84a8',
  Distracted: '#e8b86d',
  'Looking Away': '#d4a050',
  Sleepy: '#b8a0c8',
  Yawning: '#c890c0',
}
const MOOD_DETAIL_COLORS: Record<string, string> = {
  Happy: '#5bb8a0',
  Neutral: '#8fa8c8',
  Confused: '#e8b86d',
  Furrowed: '#d4a050',
  Sad: '#b8a0c8',
  Surprised: '#7ab8d4',
  Angry: '#c8907a',
  Fearful: '#c8a8d0',
}

const MOOD_COLORS: Record<string, string> = {
  Focused: '#5bb8a0',
  Calm: '#3d84a8',
  Curious: '#8fa8c8',
  Distracted: '#e8b86d',
  Sleepy: '#b8a0c8',
}

function buildAttentionTimeline(concern: boolean) {
  return SESSION_TIMELINE.map(d => ({
    t: d.t,
    Attentive: concern ? Math.max(5, 20 + Math.round(Math.random() * 10)) : Math.max(10, 35 + Math.round(Math.random() * 15)),
    Focused: concern ? Math.max(5, 15 + Math.round(Math.random() * 8)) : Math.max(10, 30 + Math.round(Math.random() * 12)),
    Distracted: concern ? Math.max(10, 28 + Math.round(Math.random() * 12)) : Math.max(3, 12 + Math.round(Math.random() * 8)),
    Sleepy: concern ? Math.max(8, 20 + Math.round(Math.random() * 10)) : Math.max(0, 5 + Math.round(Math.random() * 5)),
    'Looking Away': concern ? Math.max(5, 12 + Math.round(Math.random() * 8)) : Math.max(0, 4 + Math.round(Math.random() * 5)),
    Yawning: concern ? Math.max(0, 8 + Math.round(Math.random() * 6)) : Math.max(0, 2 + Math.round(Math.random() * 4)),
  }))
}

function buildMoodTimeline(concern: boolean) {
  return SESSION_TIMELINE.map(d => ({
    t: d.t,
    Happy: concern ? Math.max(5, 15 + Math.round(Math.random() * 8)) : Math.max(10, 30 + Math.round(Math.random() * 15)),
    Neutral: Math.max(10, 28 + Math.round(Math.random() * 12)),
    Confused: concern ? Math.max(8, 22 + Math.round(Math.random() * 10)) : Math.max(2, 8 + Math.round(Math.random() * 6)),
    Furrowed: concern ? Math.max(5, 14 + Math.round(Math.random() * 8)) : Math.max(0, 5 + Math.round(Math.random() * 4)),
    Sad: concern ? Math.max(4, 12 + Math.round(Math.random() * 8)) : Math.max(0, 3 + Math.round(Math.random() * 4)),
    Surprised: Math.max(2, 6 + Math.round(Math.random() * 6)),
  }))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function AvatarDot({ student, size = 40 }: { student: typeof STUDENTS[0]; size?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: `hsl(${student.hue}, 55%, 75%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.34, fontWeight: 700, color: `hsl(${student.hue}, 40%, 30%)`,
        flexShrink: 0,
      }}
    >
      {student.initials}
    </div>
  )
}
function StatusClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
}
function TrendArrow({ trend }: { trend: string }) {
  if (trend === 'up') return <span style={{ color: '#5bb8a0', fontSize: 13 }}>↑</span>
  if (trend === 'down') return <span style={{ color: '#e8b86d', fontSize: 13 }}>↓</span>
  return <span style={{ color: '#8fa8c8', fontSize: 13 }}>→</span>
}

function MoodPill({ label }: { label: string }) {
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: MOOD_COLORS[label] + '28', color: MOOD_COLORS[label],
    }}>
      {label}
    </span>
  )
}
function StatusClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
}
// ─── Icons ────────────────────────────────────────────────────────────────────
const icons = {
  home: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>,
  users: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  eye: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>,
  chart: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" /></svg>,
  settings: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  camera: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>,
  user: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  check: (c = '#5bb8a0') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  chevronLeft: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>,
  chevronRight: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>,
  search: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
  shield: (c = 'currentColor') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  info: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>,
  smile: (c = 'currentColor') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>,
  clock: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  flag: (c = '#e8b86d') => <svg width="14" height="14" viewBox="0 0 24 24" fill={c} stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>,
  sun: (c = 'currentColor') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>,
  moon: (c = 'currentColor') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
  trash: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>,
  lock: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
  book: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
}

// ─── Layout Shell ─────────────────────────────────────────────────────────────
function PhoneFrame({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return (
    <div style={{
      width: '100%', minHeight: '100vh',
      background: dark ? '#070f18' : '#e8f2f9',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <div style={{
        width: 390, minHeight: 780, maxHeight: 900,
        background: dark ? '#0f1d2b' : '#f0f6fc',
        borderRadius: 44,
        boxShadow: dark
          ? '0 32px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)'
          : '0 32px 80px rgba(61,132,168,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Status bar */}
        <div style={{
          height: 44, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 24px',
          color: dark ? '#7aa5c0' : '#6b8ba4', fontSize: 12, fontWeight: 600,
          flexShrink: 0,
        }}>
          <StatusClock />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10 }}>●●●</span>
            <span style={{ fontSize: 10 }}>▲</span>
            <span style={{ fontSize: 10 }}>▓▓▓</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────
function BottomNav({ active, onNav, dark }: { active: NavTab; onNav: (t: NavTab) => void; dark: boolean }) {
  const tabs: { key: NavTab; label: string; icon: (c?: string) => JSX.Element }[] = [
    { key: 'home', label: 'Home', icon: icons.home },
    { key: 'students', label: 'Students', icon: icons.users },
    { key: 'monitor', label: 'Monitor', icon: icons.eye },
    { key: 'reports', label: 'Reports', icon: icons.chart },
    { key: 'settings', label: 'Settings', icon: icons.settings },
  ]
  return (
    <div style={{
      height: 72, display: 'flex', alignItems: 'center',
      background: dark ? '#162535' : '#ffffff',
      borderTop: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
      flexShrink: 0,
    }}>
      {tabs.map(({ key, label, icon }) => {
        const isActive = active === key
        const col = isActive ? '#3d84a8' : (dark ? '#7aa5c0' : '#6b8ba4')
        return (
          <button key={key} onClick={() => onNav(key)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3, padding: '8px 0',
              background: 'none', border: 'none', cursor: 'pointer',
            }}>
            {icon(col)}
            <span style={{ fontSize: 10, fontWeight: 600, color: col }}>{label}</span>
            {isActive && <div style={{ width: 4, height: 4, borderRadius: 2, background: '#3d84a8' }} />}
          </button>
        )
      })}
    </div>
  )
}

// ─── Screen: Login ────────────────────────────────────────────────────────────
function LoginScreen({ onNext, dark }: { onNext: () => void; dark: boolean }) {
  const [email, setEmail] = useState('ms.chen@lincoln.edu')
  const [pass, setPass] = useState('••••••••')
  const inp = {
    width: '100%', padding: '13px 16px', borderRadius: 12,
    border: `1.5px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
    background: dark ? '#1a2e40' : '#f8fbfe', fontSize: 15,
    color: dark ? '#e2edf6' : '#1a2b3c', outline: 'none',
    fontFamily: 'Manrope, sans-serif', fontWeight: 500,
  }
  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '32px 28px 24px', display: 'flex', flexDirection: 'column' }}>
      {/* Logo */}
      <div style={{ marginBottom: 40 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 16,
          background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            <path d="M17 11l1.5 1.5L21 10" />
          </svg>
        </div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>ClassSense</h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>
          Attendance &amp; wellbeing insights
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4, display: 'block', marginBottom: 6 }}>EMAIL</label>
          <input style={inp} value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4, display: 'block', marginBottom: 6 }}>PASSWORD</label>
          <input style={inp} type="password" value={pass} onChange={e => setPass(e.target.value)} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 13, color: '#3d84a8', fontWeight: 600, cursor: 'pointer' }}>Forgot password?</span>
        </div>
      </div>

      <button onClick={onNext} style={{
        width: '100%', padding: '15px', borderRadius: 14,
        background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
        border: 'none', color: 'white', fontSize: 16, fontWeight: 700,
        cursor: 'pointer', letterSpacing: 0.2,
      }}>
        Continue
      </button>

      <div style={{ marginTop: 'auto', paddingTop: 32 }}>
        <div style={{
          padding: '14px 16px', borderRadius: 12,
          background: dark ? '#1a2e40' : '#eef8f5',
          border: `1px solid ${dark ? '#2a4458' : '#c8eae0'}`,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          {icons.shield('#5bb8a0')}
          <p style={{ margin: 0, fontSize: 12, color: dark ? '#7aa5c0' : '#5a8a7a', lineHeight: 1.6, fontWeight: 500 }}>
            ClassSense uses camera-based recognition only during live sessions. No images are shared outside your institution.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Screen: Consent ─────────────────────────────────────────────────────────
function ConsentScreen({ onAccept, dark }: { onAccept: () => void; dark: boolean }) {
  const [agreed, setAgreed] = useState(false)
  const items = [
    { icon: icons.camera, title: 'Camera access', desc: 'Used only during active sessions for attendance and engagement detection.' },
    { icon: icons.smile, title: 'Emotion analysis', desc: 'Broad mood states (Focused, Calm, Distracted) help you understand class dynamics — no individual scoring is stored.' },
    { icon: icons.lock, title: 'Data stays local', desc: 'Face data is processed on-device. No biometric data leaves your school\'s network.' },
    { icon: icons.shield, title: 'Student privacy', desc: 'Parents and guardians are notified via your institution. You can delete any student\'s data at any time.' },
  ]
  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '24px 24px 28px', display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>
        How ClassSense uses your camera
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', lineHeight: 1.6, fontWeight: 500 }}>
        Before you start, here's a plain-language summary of what this app does — and what it doesn't.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        {items.map(({ icon, title, desc }) => (
          <div key={title} style={{
            padding: '14px 16px', borderRadius: 14,
            background: dark ? '#162535' : '#ffffff',
            border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
            display: 'flex', gap: 14,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: dark ? '#1a2e40' : '#e8f4f8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {icon('#3d84a8')}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c', marginBottom: 3 }}>{title}</div>
              <div style={{ fontSize: 12, color: dark ? '#7aa5c0' : '#6b8ba4', lineHeight: 1.6, fontWeight: 500 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Consent toggle */}
      <div style={{
        marginTop: 20, padding: '16px', borderRadius: 14,
        background: agreed ? (dark ? '#1a3a32' : '#eef8f5') : (dark ? '#162535' : '#f8fafe'),
        border: `1.5px solid ${agreed ? '#5bb8a0' : (dark ? '#2a4458' : '#d4e4ef')}`,
        display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer',
        transition: 'all 0.2s',
      }} onClick={() => setAgreed(!agreed)}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: agreed ? '#5bb8a0' : 'transparent',
          border: `2px solid ${agreed ? '#5bb8a0' : (dark ? '#4a6880' : '#b0c8d8')}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s', flexShrink: 0,
        }}>
          {agreed && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: dark ? '#e2edf6' : '#1a2b3c', lineHeight: 1.5 }}>
          I understand how camera and mood data are used, and I confirm I have the appropriate authorisation to use this with my students.
        </p>
      </div>

      <button onClick={onAccept} disabled={!agreed} style={{
        marginTop: 14, width: '100%', padding: '15px', borderRadius: 14,
        background: agreed ? 'linear-gradient(135deg, #3d84a8, #5bb8a0)' : (dark ? '#2a4458' : '#d4e4ef'),
        border: 'none', color: agreed ? 'white' : (dark ? '#4a6880' : '#a0b8c8'),
        fontSize: 16, fontWeight: 700, cursor: agreed ? 'pointer' : 'not-allowed',
        transition: 'all 0.2s',
      }}>
        Get started
      </button>
    </div>
  )
}

// ─── Screen: Home Dashboard ───────────────────────────────────────────────────
function HomeScreen({ onNav, onScreen, dark }: { onNav: (t: NavTab) => void; onScreen: (s: Screen) => void; dark: boolean }) {
  const bg = (h: string, tl: string) => `linear-gradient(135deg, ${h}, ${tl})`
  const quickActions = [
    { label: 'Register\nStudent', icon: icons.user, gradient: bg('#3d84a8', '#5ca8c8'), screen: 'registration' as Screen },
    { label: 'Take\nAttendance', icon: icons.camera, gradient: bg('#5bb8a0', '#4aa090'), screen: 'attendance' as Screen },
    { label: 'Start Mood\nMonitor', icon: icons.smile, gradient: bg('#8fa8c8', '#7090b8'), screen: 'mood' as Screen },
    { label: 'View\nReports', icon: icons.chart, gradient: bg('#b8a0c8', '#9880b0'), screen: 'reports' as Screen },
  ]
  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600 }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Good morning, Ms Chen</h2>
        </div>
        <div style={{
          width: 40, height: 40, borderRadius: 20,
          background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 15, fontWeight: 800,
        }}>SC</div>
      </div>

      {/* Today's snapshot */}
      <div style={{
        padding: '18px', borderRadius: 20,
        background: dark ? '#162535' : '#ffffff',
        border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.5, marginBottom: 14 }}>
          TODAY'S SNAPSHOT — Year 10 Science
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { label: 'Present', value: '24', sub: 'of 28', color: '#5bb8a0' },
            { label: 'Engaged', value: '78%', sub: 'class avg', color: '#3d84a8' },
            { label: 'Check-ins', value: '3', sub: 'suggested', color: '#e8b86d' },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>{label}</div>
              <div style={{ fontSize: 10, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.3 }}>QUICK ACTIONS</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {quickActions.map(({ label, icon, gradient, screen }) => (
            <button key={label} onClick={() => onScreen(screen)} style={{
              padding: '18px 16px', borderRadius: 18, background: gradient,
              border: 'none', cursor: 'pointer', textAlign: 'left',
              display: 'flex', flexDirection: 'column', gap: 12,
              boxShadow: '0 4px 16px rgba(61,132,168,0.18)',
            }}>
              <div style={{ opacity: 0.9 }}>{icon('white')}</div>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'white', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent sessions */}
      <div>
        <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.3 }}>RECENT SESSIONS</p>
        {[
          { cls: 'Year 10 Science', date: 'Today, 9:00–10:00', pct: 86, present: '24/28' },
          { cls: 'Year 8 English', date: 'Yesterday, 11:00–12:00', pct: 72, present: '22/26' },
          { cls: 'Year 11 Maths', date: '22 Jul, 13:00–14:00', pct: 79, present: '25/27' },
        ].map(({ cls, date, pct, present }) => (
          <div key={cls} onClick={() => onScreen('reports')} style={{
            padding: '12px 14px', borderRadius: 14, marginBottom: 8,
            background: dark ? '#162535' : '#ffffff',
            border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
            display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10, flexShrink: 0,
              background: dark ? '#1a3a32' : '#eef8f5',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {icons.chart('#5bb8a0')}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>{cls}</div>
              <div style={{ fontSize: 11, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>{date} · {present} present</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#3d84a8' }}>{pct}%</div>
              <div style={{ fontSize: 10, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>engaged</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Screen: Face Registration ────────────────────────────────────────────────
function RegistrationScreen({ onBack, dark }: { onBack: () => void; dark: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [studentName, setStudentName] = useState('')
  const [capturedBlobs, setCapturedBlobs] = useState<Blob[]>([])
  const [step, setStep] = useState<'name' | 'capture' | 'review' | 'saving' | 'done'>('name')
  const [error, setError] = useState<string | null>(null)
  const total =15// increased from 8 to 20 to improve registration robustness (more angle samples)

  useEffect(() => {
    if (step !== 'capture') return
    let stream: MediaStream
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(s => { stream = s; if (videoRef.current) videoRef.current.srcObject = s })
      .catch(() => setError('Camera access denied. Please allow camera permissions.'))
    return () => { stream?.getTracks().forEach(t => t.stop()) }
  }, [step])

  function captureFrame() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.videoWidth === 0) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (blob) setCapturedBlobs(prev => [...prev, blob])
    }, 'image/jpeg', 0.9)
  }

  async function handleSave() {
    setStep('saving')
    const form = new FormData()
    form.append('name', studentName)
    capturedBlobs.forEach((blob, i) => form.append('images', blob, `angle_${i}.jpg`))
    try {
      await apiPost('/api/students/register', form)
      setStep('done')
    } catch (e) {
      setError('Failed to save. Check that the backend is running.')
      setStep('review')
    }
  }

  if (step === 'name') return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          {icons.chevronLeft(dark ? '#e2edf6' : '#1a2b3c')}
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Register student</h2>
      </div>
      <label style={{ fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4' }}>STUDENT NAME</label>
      <input value={studentName} onChange={e => setStudentName(e.target.value)}
        placeholder="e.g. Amara Diallo"
        style={{
          padding: '13px 16px', borderRadius: 12, border: `1.5px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
          background: dark ? '#1a2e40' : '#f8fbfe', fontSize: 15, color: dark ? '#e2edf6' : '#1a2b3c',
          fontFamily: 'Manrope, sans-serif', fontWeight: 500,
        }} />
      <button onClick={() => studentName.trim() && setStep('capture')} disabled={!studentName.trim()} style={{
        padding: '15px', borderRadius: 14,
        background: studentName.trim() ? 'linear-gradient(135deg, #3d84a8, #5bb8a0)' : (dark ? '#2a4458' : '#d4e4ef'),
        border: 'none', color: 'white', fontSize: 16, fontWeight: 700,
        cursor: studentName.trim() ? 'pointer' : 'not-allowed',
      }}>Start capture</button>
    </div>
  )

  if (step === 'review' || step === 'saving' || step === 'done') return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button onClick={() => setStep('capture')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          {icons.chevronLeft(dark ? '#e2edf6' : '#1a2b3c')}
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>
          {step === 'done' ? 'Registered!' : 'Review photos'}
        </h2>
      </div>

      {error && <div style={{ color: '#e8b86d', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
        {capturedBlobs.map((blob, i) => (
          <img key={i} src={URL.createObjectURL(blob)} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 12 }} />
        ))}
      </div>

      {step === 'done' ? (
        <button onClick={onBack} style={{
          padding: '13px', borderRadius: 12, background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
          border: 'none', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>Done → Back home</button>
      ) : (
        <button onClick={handleSave} disabled={step === 'saving'} style={{
          padding: '13px', borderRadius: 12, background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
          border: 'none', color: 'white', fontSize: 14, fontWeight: 700,
          cursor: step === 'saving' ? 'default' : 'pointer', opacity: step === 'saving' ? 0.6 : 1,
        }}>{step === 'saving' ? 'Saving...' : 'Confirm & Save'}</button>
      )}
    </div>
  )

  // step === 'capture'
  const pct = (capturedBlobs.length / total) * 100
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          {icons.chevronLeft(dark ? '#e2edf6' : '#1a2b3c')}
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Capture angles</h2>
          <p style={{ margin: 0, fontSize: 12, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>{studentName}</p>
        </div>
      </div>

      <div style={{
        margin: '0 20px', borderRadius: 20, overflow: 'hidden',
        background: '#1a2b3c', aspectRatio: '3/4', position: 'relative',
      }}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e8b86d', fontSize: 13, textAlign: 'center', padding: 20 }}>
            {error}
          </div>
        )}
        <div style={{
          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '8px 18px',
          color: 'white', fontSize: 13, fontWeight: 600,
        }}>{capturedBlobs.length}/{total} captured</div>
      </div>

      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={captureFrame} disabled={capturedBlobs.length >= total} style={{
          width: 52, height: 52, borderRadius: 26,
          background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
          border: '3px solid white', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
        }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: 'white' }} />
        </button>
      </div>

      {capturedBlobs.length >= total && (
        <div style={{ padding: '0 20px 16px' }}>
          <button onClick={() => setStep('review')} style={{
            width: '100%', padding: '13px', borderRadius: 12,
            background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
            border: 'none', color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>Review captured photos →</button>
        </div>
      )}
    </div>
  )
}

// ─── Screen: Attendance ───────────────────────────────────────────────────────
function AttendanceScreen({ onBack, dark }: { onBack: () => void; dark: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [presentStudents, setPresentStudents] = useState<Set<string>>(new Set())
  const [seconds, setSeconds] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 1. Start camera + backend session when screen opens
  useEffect(() => {
    let stream: MediaStream

    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (e) {
        setError('Camera access denied. Please allow camera permissions.')
        return
      }

      const form = new FormData()
      form.append('class_name', 'Year 10 Science')
      const data = await apiPost('/api/attendance/start', form)
      setSessionId(data.session_id)
    }
    init()

    return () => { stream?.getTracks().forEach(t => t.stop()) }
  }, [])

  // 2. Timer for the on-screen clock
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 3. Grab a frame + send it every 800ms, once we have a session
  useEffect(() => {
    if (!sessionId) return
    const interval = setInterval(async () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.videoWidth === 0) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(video, 0, 0)

      canvas.toBlob(async (blob) => {
        if (!blob) return
        const form = new FormData()
        form.append('session_id', sessionId)
        form.append('image', blob, 'frame.jpg')
        try {
          const result = await apiPost('/api/attendance/frame', form)
          if (result.name && result.name !== 'Unknown') {
            setPresentStudents(prev => new Set(prev).add(result.name))
          }
        } catch (e) { /* skip failed frame, try again next tick */ }
      }, 'image/jpeg', 0.8)
    }, 800)
    return () => clearInterval(interval)
  }, [sessionId])

  async function handleEnd() {
    if (sessionId) {
      const form = new FormData()
      form.append('session_id', sessionId)
      await apiPost('/api/attendance/end', form)
    }
    onBack()
  }

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ flex: 1, background: '#0a1520', position: 'relative', overflow: 'hidden' }}>
        {/* REAL camera feed, replacing the fake gradient div */}
        <video ref={videoRef} autoPlay playsInline muted
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {error && (
          <div style={{ position: 'absolute', top: 60, left: 16, right: 16, background: 'rgba(200,50,50,0.9)', color: 'white', padding: 12, borderRadius: 10, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)',
        }}>
          <button onClick={handleEnd} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10,
            padding: '6px 10px', cursor: 'pointer', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', gap: 4, color: 'white', fontSize: 13, fontWeight: 600,
          }}>
            {icons.chevronLeft('white')} End
          </button>
          <div style={{
            background: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: '5px 14px',
            display: 'flex', alignItems: 'center', gap: 6, backdropFilter: 'blur(8px)',
          }}>
            <div style={{ width: 7, height: 7, borderRadius: 4, background: '#5bb8a0', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <span style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </span>
          </div>
          <div style={{
            background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: '5px 12px',
            color: 'white', fontSize: 12, fontWeight: 700, backdropFilter: 'blur(8px)',
          }}>
            {presentStudents.size}
          </div>
        </div>

        <button onClick={() => setSheetOpen(!sheetOpen)} style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>
          <div style={{
            background: dark ? 'rgba(22,37,53,0.96)' : 'rgba(240,246,252,0.96)',
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: '10px 20px 12px', backdropFilter: 'blur(12px)',
          }}>
            <div style={{ width: 32, height: 4, borderRadius: 2, background: dark ? '#4a6880' : '#b0c8d8', margin: '0 auto 8px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>
                {presentStudents.size} present
              </span>
              <span style={{ fontSize: 12, color: '#5bb8a0', fontWeight: 700 }}>{sheetOpen ? '↓' : '↑'} Details</span>
            </div>
            {sheetOpen && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                {[...presentStudents].map(name => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: dark ? '#e2edf6' : '#1a2b3c', flex: 1 }}>{name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#5bb8a0' }}>Present</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  )
}

// ─── Screen: Mood Monitor ─────────────────────────────────────────────────────
function MoodScreen({ onBack, dark }: { onBack: () => void; dark: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [videoDims, setVideoDims] = useState({ w: 340, h: 480 })
  const [faces, setFaces] = useState<any[]>([])
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Rolling history so the donut/legend reflect the whole session, not just this instant
  const attentionCounts = useRef<Record<string, number>>({})
  const moodCounts = useRef<Record<string, number>>({})
  const loadSamples = useRef<number[]>([])
  const [, forceUpdate] = useState(0) // re-render when refs change

  const CALIBRATION_SECONDS = 25

  // 1. Camera + backend session
  useEffect(() => {
    let stream: MediaStream
    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            setVideoDims({ w: videoRef.current!.videoWidth, h: videoRef.current!.videoHeight })
          }
        }
      } catch {
        setError('Camera access denied. Please allow camera permissions.')
        return
      }
      const data = await apiPost('/api/mood/start', new FormData())
      setSessionId(data.session_id)
    }
    init()
    return () => { stream?.getTracks().forEach(t => t.stop()) }
  }, [])

  // 2. Session clock
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 3. Frame capture loop — sends a frame roughly every 700ms.
  // Over the 25s calibration window that's ~35 frames, comfortably
  // above the backend's 20-sample minimum for locking in personal
  // baselines (smile, eyebrow tension, eye/mouth openness).
  useEffect(() => {
    if (!sessionId) return
    const interval = setInterval(async () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.videoWidth === 0) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)

      canvas.toBlob(async (blob) => {
        if (!blob) return
        const form = new FormData()
        form.append('session_id', sessionId)
        form.append('image', blob, 'frame.jpg')
        try {
          const result = await apiPost('/api/mood/frame', form)
          const newFaces = result.faces || []
          setFaces(newFaces)

          // Accumulate session-wide stats for the donut + legend
          for (const f of newFaces) {
            attentionCounts.current[f.attentiveness] = (attentionCounts.current[f.attentiveness] || 0) + 1
            moodCounts.current[f.mood] = (moodCounts.current[f.mood] || 0) + 1
            loadSamples.current.push(f.cognitive_load)
            if (loadSamples.current.length > 200) loadSamples.current.shift()
          }
          forceUpdate(n => n + 1)
        } catch { /* skip failed frame */ }
      }, 'image/jpeg', 0.8)
    }, 700)
    return () => clearInterval(interval)
  }, [sessionId])

  async function handleDone() {
    if (sessionId) {
      const form = new FormData()
      form.append('session_id', sessionId)
      await apiPost('/api/mood/end', form)
    }
    onBack()
  }

  const isCalibrating = seconds < CALIBRATION_SECONDS
  const avgLoad = loadSamples.current.length
    ? loadSamples.current.reduce((a, b) => a + b, 0) / loadSamples.current.length
    : 0

  const attentionColor = (a: string) =>
    a === 'attentive' || a === 'focused' ? '#5bb8a0'
    : a === 'distracted' || a === 'looking_away' ? '#e8b86d'
    : '#b8a0c8' // sleepy, yawning
  const moodColorFor = (m: string) => ({
    happy: '#5bb8a0', neutral: '#8fa8c8', confused: '#e8b86d', furrowed: '#d4a050',
    sad: '#b8a0c8', surprised: '#7ab8d4', angry: '#c8907a', fearful: '#c8a8d0',
  } as Record<string, string>)[m] ?? '#8fa8c8'

  // Donut built from real accumulated attentiveness counts
  const donutTotal = Object.values(attentionCounts.current).reduce((a, b) => a + b, 0)
  const donutData = Object.entries(attentionCounts.current).map(([name, value]) => ({
    name, value, fill: attentionColor(name),
  }))

  const worthCheckIn = !isCalibrating && avgLoad >= 55

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ flex: 1, background: '#0a1520', position: 'relative', overflow: 'hidden' }}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {error && (
          <div style={{ position: 'absolute', top: 60, left: 16, right: 16, background: 'rgba(200,50,50,0.9)', color: 'white', padding: 12, borderRadius: 10, fontSize: 13, zIndex: 5 }}>
            {error}
          </div>
        )}

        {/* Top bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)', zIndex: 4,
        }}>
          <button onClick={handleDone} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10,
            padding: '6px 10px', cursor: 'pointer', backdropFilter: 'blur(8px)',
            color: 'white', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {icons.chevronLeft('white')} Done
          </button>
          <div style={{
            background: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: '5px 14px',
            backdropFilter: 'blur(8px)', color: 'white', fontSize: 13, fontWeight: 700,
          }}>
            {isCalibrating ? `Calibrating ${seconds}/${CALIBRATION_SECONDS}s` : 'Mood Monitor · Live'}
          </div>
        </div>

        {/* Real detection overlays, scaled to actual camera resolution */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 3 }}
          viewBox={`0 0 ${videoDims.w} ${videoDims.h}`} preserveAspectRatio="xMidYMid slice">
          {faces.map((f, i) => {
            const { x, y, w, h } = f.box
            const barW = w
            const phoneAlert = Boolean(f?.phone_alert)
            const boxColor = phoneAlert ? '#e04545' : attentionColor(f.attentiveness)
            return (
              <g key={i}>
                <rect x={x} y={y} width={w} height={h} rx="8" fill="none"
                  stroke={boxColor} strokeWidth="2" opacity="0.85" />
                <rect x={x} y={y - 34} width={barW} height={12} rx="6" fill="rgba(0,0,0,0.45)" />
                <rect x={x} y={y - 34} width={barW * (f.attentiveness_confidence / 100)} height={12} rx="6"
                  fill={boxColor} opacity="0.9" />
                <text x={x + 6} y={y - 25} fontSize="10" fill="white" fontFamily="Manrope" fontWeight="700">
                  {f.attentiveness}
                </text>
                <rect x={x} y={y - 20} width={barW} height={10} rx="5" fill="rgba(0,0,0,0.35)" />
                <rect x={x} y={y - 20} width={barW * (f.mood_confidence / 100)} height={10} rx="5"
                  fill={moodColorFor(f.mood)} opacity="0.85" />
                <text x={x + 6} y={y - 12} fontSize="8" fill="rgba(255,255,255,0.9)" fontFamily="Manrope" fontWeight="600">
                  {f.mood}
                </text>
                <rect x={x} y={y + h} width={barW} height={18} fill="rgba(0,0,0,0.4)" />
                <text x={x + 5} y={y + h + 13} fontSize="10" fill="white" fontFamily="Manrope" fontWeight="700">
                  {f.name} · load {Math.round(f.cognitive_load)}{phoneAlert ? ' · phone' : ''}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Floating donut — real aggregated attentiveness distribution */}
        {donutTotal > 0 && (
          <div style={{
            position: 'absolute', bottom: 90, right: 14, zIndex: 4,
            background: 'rgba(0,0,0,0.55)', borderRadius: 16, padding: 8,
            backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          }}>
            <svg width="70" height="70">
              <circle cx="35" cy="35" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
              {donutData.reduce((acc, seg) => {
                const offset = 2 * Math.PI * 28 * (acc.soFar / donutTotal)
                const dash = 2 * Math.PI * 28 * (seg.value / donutTotal) - 2
                acc.els.push(
                  <circle key={seg.name} cx="35" cy="35" r="28" fill="none"
                    stroke={seg.fill} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${Math.max(0, dash)} ${2 * Math.PI * 28}`}
                    strokeDashoffset={-offset + 2 * Math.PI * 28 * 0.25}
                    transform="rotate(-90 35 35)" />
                )
                return { soFar: acc.soFar + seg.value, els: acc.els }
              }, { soFar: 0, els: [] as JSX.Element[] }).els}
              <text x="35" y="39" textAnchor="middle" fill="white" fontSize="12" fontWeight="800" fontFamily="Manrope">
                {Math.round(avgLoad)}
              </text>
            </svg>
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>AVG LOAD</span>
          </div>
        )}

        {/* Bottom legend */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 4,
          background: dark ? 'rgba(22,37,53,0.95)' : 'rgba(240,246,252,0.95)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '10px 16px', backdropFilter: 'blur(12px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>
              {isCalibrating
                ? 'Learning this face — keep it in frame'
                : `Session avg cognitive load: ${Math.round(avgLoad)}`}
            </span>
          </div>
          {worthCheckIn && (
            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: '#e8b86d' }} />
              <span style={{ fontSize: 11, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>
                Sustained load is elevated — may be worth a check-in
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
// ─── Screen: Reports ──────────────────────────────────────────────────────────
function ReportsScreen({ onStudent, dark }: { onStudent: (s: any) => void; dark: boolean }) {
  const [data, setData] = useState<{
    students: { name: string; engagementAvg: number; flag: boolean }[]
    avgEngagement: number | null
    topPerformer: string | null
    needsCheckIn: number
    timeline: { t: string; engagement: number }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet('/api/reports/summary')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: dark ? '#7aa5c0' : '#6b8ba4' }}>Loading reports…</div>
  }

  if (!data || data.students.length === 0) {
    return (
      <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px' }}>
        <h2 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Reports</h2>
        <p style={{ marginTop: 20, fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4' }}>
          No session data yet. Run a Mood Monitor session first — reports populate from real recorded sessions.
        </p>
      </div>
    )
  }

  const maxEng = Math.max(...data.students.map(s => s.engagementAvg))

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Reports</h2>
        <p style={{ margin: 0, fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>All sessions</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          { label: 'Avg Engagement', value: data.avgEngagement != null ? `${data.avgEngagement}%` : '—', color: '#3d84a8' },
          { label: 'Top Performer', value: data.topPerformer ?? '—', color: '#5bb8a0' },
          { label: 'Needs Check-in', value: String(data.needsCheckIn), color: '#e8b86d' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            padding: '12px 10px', borderRadius: 14, textAlign: 'center',
            background: dark ? '#162535' : '#ffffff',
            border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color, marginBottom: 2 }}>{value}</div>
            <div style={{ fontSize: 10, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '16px', borderRadius: 16, background: dark ? '#162535' : '#ffffff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}` }}>
        <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.3 }}>
          AVERAGE ENGAGEMENT PER STUDENT
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.students.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => onStudent(s)}>
              <div style={{ width: 54, fontSize: 11, fontWeight: 600, color: dark ? '#e2edf6' : '#1a2b3c', flexShrink: 0 }}>
                {s.name.split(' ')[0]}
              </div>
              <div style={{ flex: 1, height: 10, borderRadius: 5, background: dark ? '#1a2e40' : '#eef3f8', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 5, width: `${(s.engagementAvg / maxEng) * 100}%`,
                  background: s.flag ? 'linear-gradient(90deg, #e8b86d, #d4a050)' : 'linear-gradient(90deg, #3d84a8, #5bb8a0)',
                }} />
              </div>
              <div style={{ width: 32, fontSize: 12, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c', textAlign: 'right' }}>
                {s.engagementAvg}%
              </div>
              {s.flag && <div title="Worth checking in">{icons.flag()}</div>}
            </div>
          ))}
        </div>
      </div>

      {data.timeline.length > 0 && (
        <div style={{ padding: '16px', borderRadius: 16, background: dark ? '#162535' : '#ffffff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}` }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.3 }}>
            CLASS ENGAGEMENT OVER SESSION
          </p>
          <ResponsiveContainer width="100%" height={110}>
            <LineChart data={data.timeline} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#2a4458' : '#e8f0f8'} />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: dark ? '#7aa5c0' : '#6b8ba4', fontFamily: 'Manrope' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: dark ? '#7aa5c0' : '#6b8ba4', fontFamily: 'Manrope' }} />
              <Tooltip contentStyle={{ background: dark ? '#162535' : '#fff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`, borderRadius: 8, fontSize: 12, fontFamily: 'Manrope' }} />
              <Line type="monotone" dataKey="engagement" stroke="#3d84a8" strokeWidth={2.5} dot={{ r: 4, fill: '#3d84a8' }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ─── Screen: Report Detail ─────────────────────────────────────────────────────
function ReportDetailScreen({ student, onBack, dark }: { student: typeof STUDENTS[0]; onBack: () => void; dark: boolean }) {
  const concern = student.engagementAvg < 65 || student.flag

  const timeline = SESSION_TIMELINE.map(d => ({
    ...d,
    engagement: Math.max(40, d.engagement + (concern ? -22 : 5) + Math.round(Math.random() * 8 - 4)),
  }))

  const attentionTimeline = buildAttentionTimeline(concern)
  const moodTimeline = buildMoodTimeline(concern)

  // Pie data: sum each key across timeline
  const attentionKeys = ['Attentive', 'Focused', 'Distracted', 'Looking Away', 'Sleepy', 'Yawning'] as const
  const moodKeys = ['Happy', 'Neutral', 'Confused', 'Furrowed', 'Sad', 'Surprised'] as const

  const attentionPie = attentionKeys.map(k => {
    const total2 = attentionTimeline.reduce((s, d) => s + (d[k] ?? 0), 0)
    return { name: k, value: Math.round(total2 / attentionTimeline.length), fill: ATTENTION_COLORS[k] }
  }).sort((a, b) => b.value - a.value)

  const moodPie = moodKeys.map(k => {
    const total2 = moodTimeline.reduce((s, d) => s + (d[k] ?? 0), 0)
    return { name: k, value: Math.round(total2 / moodTimeline.length), fill: MOOD_DETAIL_COLORS[k] }
  }).sort((a, b) => b.value - a.value)

  // Students flagged as low-attentive (for the class-level "look into" section)
  const lowAttentive = STUDENTS.filter(s => s.flag || s.engagementAvg < 65).slice(0, 3)

  const card = { padding: '14px', borderRadius: 16, background: dark ? '#162535' : '#ffffff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}` }
  const sectionLabel = { margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4 } as const
  const tooltipStyle = { background: dark ? '#162535' : '#fff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`, borderRadius: 8, fontSize: 10, fontFamily: 'Manrope' }
  const tickStyle = { fontSize: 9, fill: dark ? '#7aa5c0' : '#6b8ba4', fontFamily: 'Manrope' }

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 28 }}>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          {icons.chevronLeft(dark ? '#e2edf6' : '#1a2b3c')}
        </button>
        <AvatarDot student={student} size={40} />
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>{student.name}</div>
          <div style={{ fontSize: 12, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>Year 10 Science · Today's session</div>
        </div>
      </div>

      {/* Status banner */}
      <div style={{
        padding: '14px 16px', borderRadius: 14,
        background: concern ? (dark ? '#2a1f0a' : '#fef9ee') : (dark ? '#0a2a1f' : '#eef8f5'),
        border: `1.5px solid ${concern ? '#e8b86d' : '#5bb8a0'}`,
        display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <span style={{ fontSize: 22 }}>{concern ? '💛' : '✅'}</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: concern ? '#c49030' : '#3a8870', marginBottom: 2 }}>
            {concern ? 'Worth checking in on' : 'No concerns this session'}
          </div>
          <div style={{ fontSize: 12, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>
            {concern
              ? `${student.name.split(' ')[0]} showed lower engagement and higher distraction than usual.`
              : `${student.name.split(' ')[0]} was engaged and attentive throughout.`}
          </div>
        </div>
      </div>

      {/* ── Engagement timeline ── */}
      <div style={card}>
        <p style={sectionLabel}>ENGAGEMENT OVER SESSION</p>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={timeline} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#2a4458' : '#e8f0f8'} />
            <XAxis dataKey="t" tick={tickStyle} />
            <YAxis domain={[30, 100]} tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="engagement" stroke={concern ? '#e8b86d' : '#5bb8a0'} strokeWidth={2.5} dot={{ r: 3, fill: concern ? '#e8b86d' : '#5bb8a0' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Attentiveness track: line chart ── */}
      <div style={card}>
        <p style={sectionLabel}>ATTENTIVENESS OVER SESSION</p>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={attentionTimeline} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#2a4458' : '#e8f0f8'} />
            <XAxis dataKey="t" tick={tickStyle} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {(['Attentive', 'Focused', 'Distracted', 'Sleepy', 'Looking Away', 'Yawning'] as const).map(k => (
              <Line key={k} type="monotone" dataKey={k} stroke={ATTENTION_COLORS[k]}
                strokeWidth={k === 'Distracted' || k === 'Sleepy' ? 2 : 1.5}
                dot={false} strokeDasharray={k === 'Yawning' || k === 'Looking Away' ? '4 3' : undefined} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 8 }}>
          {(['Attentive', 'Focused', 'Distracted', 'Looking Away', 'Sleepy', 'Yawning'] as const).map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: ATTENTION_COLORS[k], flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600 }}>{k}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Attentiveness pie ── */}
      <div style={card}>
        <p style={sectionLabel}>ATTENTIVENESS BREAKDOWN</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <PieChart width={120} height={120}>
            <Pie data={attentionPie} cx={55} cy={55} innerRadius={30} outerRadius={52} dataKey="value" paddingAngle={2}>
              {attentionPie.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
          </PieChart>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {attentionPie.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: d.fill, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: dark ? '#e2edf6' : '#1a2b3c', fontWeight: 600, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 10, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 700 }}>{d.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mood track: line chart ── */}
      <div style={card}>
        <p style={sectionLabel}>MOOD OVER SESSION</p>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={moodTimeline} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#2a4458' : '#e8f0f8'} />
            <XAxis dataKey="t" tick={tickStyle} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {(['Happy', 'Neutral', 'Confused', 'Furrowed', 'Sad', 'Surprised'] as const).map(k => (
              <Line key={k} type="monotone" dataKey={k} stroke={MOOD_DETAIL_COLORS[k]}
                strokeWidth={k === 'Happy' || k === 'Neutral' ? 2 : 1.5}
                dot={false} strokeDasharray={k === 'Sad' || k === 'Fearful' ? '4 3' : undefined} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 8 }}>
          {(['Happy', 'Neutral', 'Confused', 'Furrowed', 'Sad', 'Surprised'] as const).map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: MOOD_DETAIL_COLORS[k], flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600 }}>{k}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Mood pie ── */}
      <div style={card}>
        <p style={sectionLabel}>MOOD BREAKDOWN</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <PieChart width={120} height={120}>
            <Pie data={moodPie} cx={55} cy={55} innerRadius={30} outerRadius={52} dataKey="value" paddingAngle={2}>
              {moodPie.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
          </PieChart>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {moodPie.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: d.fill, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: dark ? '#e2edf6' : '#1a2b3c', fontWeight: 600, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 10, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 700 }}>{d.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Worth looking into ── */}
      <div style={{
        ...card,
        background: dark ? '#1e2e1a' : '#fdfaf3',
        border: `1.5px solid ${dark ? '#3a4a28' : '#e8d8a0'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 17 }}>🔍</span>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: dark ? '#d4c870' : '#9a7a20', letterSpacing: 0.3 }}>
            STUDENTS WORTH LOOKING INTO — LOW ATTENTIVENESS
          </p>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: dark ? '#a0b880' : '#7a6830', fontWeight: 500, lineHeight: 1.6 }}>
          These students showed notably higher distraction or sleepiness patterns this session. A brief check-in may help.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lowAttentive.map(s => {
            const dominantAttention = s.engagementAvg < 60 ? 'Sleepy / Distracted' : 'Frequently Distracted'
            const pct = s.engagementAvg
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 12,
                background: dark ? '#162535' : '#ffffff',
                border: `1px solid ${dark ? '#2a4458' : '#e0d0a0'}`,
              }}>
                <AvatarDot student={s} size={34} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500, marginTop: 2 }}>
                    Pattern: <span style={{ color: '#d4a050', fontWeight: 700 }}>{dominantAttention}</span>
                  </div>
                  <div style={{ marginTop: 5, height: 5, borderRadius: 3, background: dark ? '#1a2e40' : '#eef3f8', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: 'linear-gradient(90deg, #e8b86d, #d4a050)' }} />
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#d4a050' }}>{pct}%</div>
                  <div style={{ fontSize: 9, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600 }}>engaged</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Attendance stat */}
      <div style={card}>
        <p style={sectionLabel}>ATTENDANCE THIS TERM</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: student.attendancePct >= 90 ? '#5bb8a0' : '#e8b86d' }}>{student.attendancePct}%</div>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: dark ? '#1a2e40' : '#eef3f8', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, width: `${student.attendancePct}%`, background: student.attendancePct >= 90 ? 'linear-gradient(90deg,#5bb8a0,#3d84a8)' : 'linear-gradient(90deg,#e8b86d,#d4a050)' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Screen: Students ─────────────────────────────────────────────────────────
function StudentsScreen({ onStudent, dark }: { onStudent: (s: any) => void; dark: boolean }) {
  const [students, setStudents] = useState<{ name: string; engagementAvg: number; flag: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    apiGet('/api/reports/summary')
      .then(data => setStudents(data.students || []))
      .catch(() => setStudents([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = students.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Students</h2>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 12,
        background: dark ? '#162535' : '#ffffff',
        border: `1.5px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
      }}>
        {icons.search(dark ? '#7aa5c0' : '#6b8ba4')}
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search students..."
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 14, color: dark ? '#e2edf6' : '#1a2b3c', fontFamily: 'Manrope',
          }}
        />
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', textAlign: 'center', marginTop: 20 }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', textAlign: 'center', marginTop: 20 }}>
          No students with session data yet. Run a Mood Monitor session to populate this list.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(student => (
            <div key={student.name} onClick={() => onStudent(student)} style={{
              padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
              background: dark ? '#162535' : '#ffffff',
              border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: dark ? '#1a3a32' : '#eef8f5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 700, color: '#3d84a8', flexShrink: 0,
              }}>
                {student.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>{student.name}</span>
                  {student.flag && icons.flag()}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: student.engagementAvg >= 75 ? '#5bb8a0' : student.engagementAvg >= 60 ? '#3d84a8' : '#e8b86d' }}>
                  {student.engagementAvg}%
                </div>
                <div style={{ fontSize: 10, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600 }}>engagement</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
// ─── Screen: Student Detail ────────────────────────────────────────────────────
function StudentDetailScreen({ student, onBack, dark }: {
  student: { name: string; engagementAvg: number; flag: boolean }
  onBack: () => void
  dark: boolean
}) {
  const initials = student.name.slice(0, 2).toUpperCase()
  // Deterministic hue from the name so the same student always gets the same color,
  // without needing a stored `hue` field from the backend.
  const hue = student.name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          {icons.chevronLeft(dark ? '#e2edf6' : '#1a2b3c')}
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Student Profile</h2>
      </div>

      {/* Profile card */}
      <div style={{
        padding: '20px', borderRadius: 20,
        background: dark ? '#162535' : '#ffffff',
        border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: '50%',
          background: `hsl(${hue}, 55%, 75%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: `hsl(${hue}, 40%, 30%)`, flexShrink: 0,
        }}>
          {initials}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>{student.name}</div>
          <div style={{ fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>
            {student.flag ? 'Worth checking in on' : 'No concerns'}
          </div>
        </div>
      </div>

      {/* Engagement stat */}
      <div style={{
        padding: '20px', borderRadius: 16,
        background: dark ? '#162535' : '#ffffff',
        border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 32, fontWeight: 800,
          color: student.engagementAvg >= 75 ? '#5bb8a0' : student.engagementAvg >= 60 ? '#3d84a8' : '#e8b86d',
        }}>
          {student.engagementAvg}%
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c', marginTop: 4 }}>
          Average Engagement
        </div>
        <div style={{ fontSize: 11, color: dark ? '#7aa5c0' : '#6b8ba4', marginTop: 2 }}>
          across all logged sessions
        </div>
      </div>

      {/* Flag banner */}
      {student.flag && (
        <div style={{
          padding: '14px 16px', borderRadius: 14,
          background: dark ? '#2a1f0a' : '#fef9ee',
          border: '1.5px solid #e8b86d',
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span style={{ fontSize: 20 }}>💛</span>
          <p style={{ margin: 0, fontSize: 12, color: dark ? '#a0b880' : '#7a6830', fontWeight: 500, lineHeight: 1.5 }}>
            This student's average engagement is below 65% — a brief check-in may help.
          </p>
        </div>
      )}

      {/* Note about what's coming */}
      <div style={{
        padding: '14px', borderRadius: 14,
        background: dark ? '#162535' : '#ffffff',
        border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
      }}>
        <p style={{ margin: 0, fontSize: 12, color: dark ? '#7aa5c0' : '#6b8ba4', lineHeight: 1.6 }}>
          Attendance history, mood breakdown, and registration photos for individual
          students will appear here in a future update, once the backend tracks
          per-student attendance and mood data over time.
        </p>
      </div>
    </div>
  )
}

// ─── Screen: Settings ─────────────────────────────────────────────────────────
function SettingsScreen({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  const [camPerm, setCamPerm] = useState(true)
  const [retention, setRetention] = useState(30)
  const [autoDelete, setAutoDelete] = useState(true)
  const [notifications, setNotifications] = useState(true)

  const Toggle = ({ value, onChange }: { value: boolean; onChange: () => void }) => (
    <button onClick={onChange} style={{
      width: 44, height: 26, borderRadius: 13, flexShrink: 0,
      background: value ? '#3d84a8' : (dark ? '#2a4458' : '#d4e4ef'),
      border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 20, height: 20, borderRadius: 10, background: 'white',
        transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }} />
    </button>
  )

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4 }}>{title}</p>
      <div style={{ borderRadius: 16, background: dark ? '#162535' : '#ffffff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )

  const Row = ({ icon, label, right, border = true }: { icon: JSX.Element; label: string; right: React.ReactNode; border?: boolean }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
      borderBottom: border ? `1px solid ${dark ? '#2a4458' : '#d4e4ef'}` : 'none',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: dark ? '#1a2e40' : '#eef3f8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>
      <span style={{ fontSize: 14, fontWeight: 600, color: dark ? '#e2edf6' : '#1a2b3c', flex: 1 }}>{label}</span>
      {right}
    </div>
  )

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Settings</h2>

      <Section title="APPEARANCE">
        <Row icon={dark ? icons.moon('#3d84a8') : icons.sun('#3d84a8')} label={dark ? 'Dark mode' : 'Light mode'}
          right={<Toggle value={dark} onChange={onToggleDark} />} border={false} />
      </Section>

      <Section title="CAMERA &amp; PERMISSIONS">
        <Row icon={icons.camera('#3d84a8')} label="Camera access" right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: camPerm ? '#5bb8a0' : '#e8b86d', fontWeight: 700 }}>{camPerm ? 'Allowed' : 'Denied'}</span>
            <Toggle value={camPerm} onChange={() => setCamPerm(!camPerm)} />
          </div>
        } />
        <Row icon={icons.eye('#3d84a8')} label="Mood analysis" right={<Toggle value={true} onChange={() => {}} />} border={false} />
      </Section>

      <Section title="DATA &amp; PRIVACY">
        <Row icon={icons.trash('#3d84a8')} label="Data retention" right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select value={retention} onChange={e => setRetention(Number(e.target.value))} style={{
              background: dark ? '#1a2e40' : '#eef3f8', border: 'none', borderRadius: 8,
              padding: '4px 8px', fontSize: 13, color: dark ? '#e2edf6' : '#1a2b3c',
              fontFamily: 'Manrope', fontWeight: 600, cursor: 'pointer',
            }}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
            </select>
          </div>
        } />
        <Row icon={icons.shield('#3d84a8')} label="Auto-delete face data" right={<Toggle value={autoDelete} onChange={() => setAutoDelete(!autoDelete)} />} />
        <Row icon={icons.lock('#3d84a8')} label="Student data export" right={
          <span style={{ fontSize: 13, color: '#3d84a8', fontWeight: 600 }}>Request →</span>
        } border={false} />
      </Section>

      <Section title="NOTIFICATIONS">
        <Row icon={icons.info('#3d84a8')} label="Check-in suggestions" right={<Toggle value={notifications} onChange={() => setNotifications(!notifications)} />} border={false} />
      </Section>

      <Section title="LEGAL">
        <Row icon={icons.book('#3d84a8')} label="Privacy policy" right={icons.chevronRight('#3d84a8')} />
        <Row icon={icons.book('#3d84a8')} label="Terms of use" right={icons.chevronRight('#3d84a8')} />
        <Row icon={icons.info('#3d84a8')} label="About ClassSense" right={
          <span style={{ fontSize: 12, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600 }}>v1.2.0</span>
        } border={false} />
      </Section>

      <p style={{ margin: 0, fontSize: 11, color: dark ? '#4a6880' : '#a0b8c8', textAlign: 'center', fontWeight: 500 }}>
        ClassSense · Your institution's data stays yours.
      </p>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark] = useState(false)
  const [screen, setScreen] = useState<Screen>('login')
  const [navTab, setNavTab] = useState<NavTab>('home')
  const [selectedStudent, setSelectedStudent] = useState<typeof STUDENTS[0] | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const handleNav = (tab: NavTab) => {
    setNavTab(tab)
    const map: Record<NavTab, Screen> = {
      home: 'home', students: 'students', monitor: 'mood', reports: 'reports', settings: 'settings',
    }
    setScreen(map[tab])
  }

  const needsNav = ['home', 'students', 'mood', 'reports', 'report-detail', 'student-detail', 'settings'].includes(screen)
  const fullscreen = ['attendance', 'mood'].includes(screen)

  return (
    <PhoneFrame dark={dark}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {screen === 'login' && <LoginScreen dark={dark} onNext={() => setScreen('consent')} />}
        {screen === 'consent' && <ConsentScreen dark={dark} onAccept={() => { setScreen('home'); setNavTab('home') }} />}
        {screen === 'home' && <HomeScreen dark={dark} onNav={handleNav} onScreen={s => setScreen(s)} />}
        {screen === 'registration' && <RegistrationScreen dark={dark} onBack={() => setScreen('home')} />}
        {screen === 'attendance' && <AttendanceScreen dark={dark} onBack={() => setScreen('home')} />}
        {screen === 'mood' && <MoodScreen dark={dark} onBack={() => { setScreen('home'); setNavTab('home') }} />}
        {screen === 'reports' && <ReportsScreen dark={dark} onStudent={s => { setSelectedStudent(s); setScreen('report-detail') }} />}
        {screen === 'report-detail' && selectedStudent && <ReportDetailScreen dark={dark} student={selectedStudent} onBack={() => setScreen('reports')} />}
        {screen === 'students' && <StudentsScreen dark={dark} onStudent={s => { setSelectedStudent(s); setScreen('student-detail') }} />}
        {screen === 'student-detail' && selectedStudent && <StudentDetailScreen dark={dark} student={selectedStudent} onBack={() => setScreen('students')} />}
        {screen === 'settings' && <SettingsScreen dark={dark} onToggleDark={() => setDark(d => !d)} />}
      </div>

      {needsNav && !fullscreen && (
        <BottomNav active={navTab} onNav={handleNav} dark={dark} />
      )}

      {/* Dark mode FAB on login/consent */}
      {(screen === 'login' || screen === 'consent') && (
        <div style={{ position: 'absolute', top: 52, right: 16, zIndex: 10 }}>
          <button onClick={() => setDark(d => !d)} style={{
            width: 34, height: 34, borderRadius: 17,
            background: dark ? '#162535' : '#ffffff',
            border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {dark ? icons.sun('#3d84a8') : icons.moon('#3d84a8')}
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </PhoneFrame>
  )
}
