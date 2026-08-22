import { useState, useEffect, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Sector
} from 'recharts'
import { apiPost, apiPostJson, apiGet } from './api'

// ─── Types ───────────────────────────────────────────────────────────────────
type Screen =
  | 'login'
  | 'consent'
  | 'roster-import'
  | 'student-consent'
  | 'home'
  | 'registration'
  | 'attendance'
  | 'mood'
  | 'reports'
  | 'report-detail'
  | 'weekly-report'
  | 'students'
  | 'student-detail'
  | 'settings'

type NavTab = 'home' | 'students' | 'monitor' | 'reports' | 'settings'

// A roster entry as returned by GET/POST /api/students/roster --
// consent_status starts 'pending' at import and face_registered starts
// false until RegistrationScreen successfully saves a face for them.
type ConsentStatus = 'pending' | 'biometric' | 'non_biometric'
type RosterStudent = {
  id: number
  name: string
  consent_status: ConsentStatus
  face_registered: boolean
}

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

// ─── Class / Timeslot config ─────────────────────────────────────────────────
// College-year options shown in the login dropdown.
const CLASS_YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'] as const
type ClassYear = typeof CLASS_YEARS[number]

type Period = { id: string; label: string; start: string }

// 8 periods of 45 minutes each, 9:30 -> 4:15, with a fixed recess
// (12:30-1:15) that is not a selectable attendance slot.
function buildPeriods(): Period[] {
  const raw = [
    ['09:30', '10:15'],
    ['10:15', '11:00'],
    ['11:00', '11:45'],
    ['11:45', '12:30'],
    // 12:30 - 1:15 recess (no period, no attendance slot)
    ['13:15', '14:00'],
    ['14:00', '14:45'],
    ['14:45', '15:30'],
    ['15:30', '16:15'],
  ]
  const to12h = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2, '0')} ${period}`
  }
  return raw.map(([start, end], i) => ({
    id: `period-${i + 1}`,
    label: `Period ${i + 1} · ${to12h(start)} – ${to12h(end)}`,
    start,
  }))
}
const PERIODS = buildPeriods()

// Time-of-day greeting: before 12pm = morning, 12pm-5pm = afternoon, after 5pm = evening.
function getTimeGreeting(): 'Good morning' | 'Good Afternoon' | 'Good Evening' {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
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
  sparkle: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7L12 3z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></svg>,
  trendUp: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>,
  trendDown: (c = 'currentColor') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>,
  upload: (c = 'currentColor') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>,
  fingerprint: (c = 'currentColor') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 2 .5 4 2 6" /><path d="M12 2a8 8 0 0 1 8 8c0 3-1 5-2 7" /><path d="M9 5.5A5 5 0 0 1 17 10c0 2-.3 3.7-1 5" /><path d="M7 20c1.5-2 2-4 2-6a3 3 0 0 1 6 0c0 1.2-.2 2.3-.6 3.4" /><path d="M12 10v3" /></svg>,
  clipboard: (c = 'currentColor') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z" /><rect x="4" y="4" width="16" height="18" rx="2" /><line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="16" y2="15" /></svg>,
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
type LoginDetails = { professorName: string; classYear: ClassYear; periodId: string }

function LoginScreen({ onNext, dark }: { onNext: (details: LoginDetails) => void; dark: boolean }) {
  const [email, setEmail] = useState('ms.chen@lincoln.edu')
  const [pass, setPass] = useState('••••••••')
  const [professorName, setProfessorName] = useState('')
  const [classYear, setClassYear] = useState<ClassYear>(CLASS_YEARS[0])
  const [periodId, setPeriodId] = useState(PERIODS[0].id)

  const inp = {
    width: '100%', padding: '13px 16px', borderRadius: 12,
    border: `1.5px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
    background: dark ? '#1a2e40' : '#f8fbfe', fontSize: 15,
    color: dark ? '#e2edf6' : '#1a2b3c', outline: 'none',
    fontFamily: 'Manrope, sans-serif', fontWeight: 500,
  }
  const select = { ...inp, appearance: 'none' as const, cursor: 'pointer' }
  const label = { fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4, display: 'block', marginBottom: 6 }

  const canContinue = professorName.trim().length > 0

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '32px 28px 24px', display: 'flex', flexDirection: 'column' }}>
      {/* Logo */}
      <div style={{ marginBottom: 32 }}>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
        <div>
          <label style={label}>EMAIL</label>
          <input style={inp} value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label style={label}>PASSWORD</label>
          <input style={inp} type="password" value={pass} onChange={e => setPass(e.target.value)} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 13, color: '#3d84a8', fontWeight: 600, cursor: 'pointer' }}>Forgot password?</span>
        </div>
      </div>

      {/* Class session details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div>
          <label style={label}>PROFESSOR NAME</label>
          <input style={inp} value={professorName} onChange={e => setProfessorName(e.target.value)}
            placeholder="e.g. Sumi Ghosh" />
        </div>
        <div>
          <label style={label}>CLASS / YEAR</label>
          <select style={select} value={classYear} onChange={e => setClassYear(e.target.value as ClassYear)}>
            {CLASS_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>TIME SLOT</label>
          <select style={select} value={periodId} onChange={e => setPeriodId(e.target.value)}>
            {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>
            12:30 PM – 1:15 PM is recess — no attendance slot during that time.
          </p>
        </div>
      </div>

      <button
        onClick={() => canContinue && onNext({ professorName: professorName.trim(), classYear, periodId })}
        disabled={!canContinue}
        style={{
          width: '100%', padding: '15px', borderRadius: 14,
          background: canContinue ? 'linear-gradient(135deg, #3d84a8, #5bb8a0)' : (dark ? '#2a4458' : '#d4e4ef'),
          border: 'none', color: canContinue ? 'white' : (dark ? '#4a6880' : '#a0b8c8'),
          fontSize: 16, fontWeight: 700,
          cursor: canContinue ? 'pointer' : 'not-allowed', letterSpacing: 0.2,
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

// ─── Screen: Consent (teacher-level acknowledgement) ──────────────────────────
function ConsentScreen({ onAccept, dark, creating, error }: {
  onAccept: () => void; dark: boolean; creating: boolean; error: string | null
}) {
  const [agreed, setAgreed] = useState(false)
  const items = [
    { icon: icons.camera, title: 'Camera access', desc: 'Used only during active sessions for attendance and engagement detection.' },
    { icon: icons.smile, title: 'Emotion analysis', desc: 'Broad mood states (Focused, Calm, Distracted) help you understand class dynamics — no individual scoring is stored.' },
    { icon: icons.lock, title: 'Data stays local', desc: 'Face data is processed on-device. No biometric data leaves your school\'s network.' },
    { icon: icons.shield, title: 'Student privacy', desc: 'Each student chooses biometric or non-biometric attendance on the next screen. You can change any student\'s choice at any time.' },
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

      {error && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: '#e8b86d', fontWeight: 600, textAlign: 'center' }}>{error}</p>
      )}

      <button onClick={onAccept} disabled={!agreed || creating} style={{
        marginTop: 14, width: '100%', padding: '15px', borderRadius: 14,
        background: (agreed && !creating) ? 'linear-gradient(135deg, #3d84a8, #5bb8a0)' : (dark ? '#2a4458' : '#d4e4ef'),
        border: 'none', color: (agreed && !creating) ? 'white' : (dark ? '#4a6880' : '#a0b8c8'),
        fontSize: 16, fontWeight: 700, cursor: (agreed && !creating) ? 'pointer' : 'not-allowed',
        transition: 'all 0.2s',
      }}>
        {creating ? 'Setting up your class…' : 'Get started'}
      </button>
    </div>
  )
}

// ─── Screen: Roster Import ─────────────────────────────────────────────────────
// Step 2 of the workflow. Teacher pastes names and/or uploads a CSV; both
// sources are merged, deduped, and sent to POST /api/students/roster in one
// go. Every imported name starts consent_status='pending' server-side --
// the next screen (StudentConsentScreen) is where that gets resolved.
function parseNamesFromCsvText(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const names: string[] = []
  for (const line of lines) {
    const firstCell = line.split(',')[0]?.trim().replace(/^"|"$/g, '')
    if (!firstCell) continue
    // Skip an obvious header row ("name", "student name", "full name", ...)
    if (/^(name|student|student name|full name|roster)$/i.test(firstCell)) continue
    names.push(firstCell)
  }
  return names
}

function RosterImportScreen({ classId, dark, onImported }: {
  classId: number
  dark: boolean
  onImported: (roster: RosterStudent[]) => void
}) {
  const [pasteText, setPasteText] = useState('')
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvNames, setCsvNames] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pastedNames = pasteText
    .split(/\r?\n|,/)
    .map(n => n.trim())
    .filter(Boolean)

  const allNames = Array.from(new Set([...pastedNames, ...csvNames]))

  async function handleFile(file: File) {
    setError(null)
    try {
      const text = await file.text()
      const names = parseNamesFromCsvText(text)
      if (names.length === 0) {
        setError('Could not find any names in that file — check it has one name per row.')
        return
      }
      setCsvFileName(file.name)
      setCsvNames(names)
    } catch {
      setError('Could not read that file. Try a plain .csv export.')
    }
  }

  async function handleImport() {
    if (allNames.length === 0) return
    setImporting(true)
    setError(null)
    try {
      await apiPostJson('/api/students/roster', { class_id: classId, names: allNames })
      const roster = await apiGet(`/api/students/roster?class_id=${classId}`)
      onImported(roster.students || [])
    } catch {
      setError('Could not import the roster. Check that the backend is running.')
    } finally {
      setImporting(false)
    }
  }

  const inp = {
    width: '100%', padding: '13px 16px', borderRadius: 12,
    border: `1.5px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
    background: dark ? '#1a2e40' : '#f8fbfe', fontSize: 14,
    color: dark ? '#e2edf6' : '#1a2b3c', outline: 'none',
    fontFamily: 'Manrope, sans-serif', fontWeight: 500, resize: 'vertical' as const,
  }
  const label = { fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4, display: 'block', marginBottom: 6 }

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '24px 24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Import your roster</h2>
        <p style={{ margin: 0, fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', lineHeight: 1.6, fontWeight: 500 }}>
          Paste names, upload a CSV, or both — they'll be combined into one roster for this class.
        </p>
      </div>

      {/* Paste */}
      <div>
        <label style={label}>PASTE NAMES (one per line, or comma-separated)</label>
        <textarea
          value={pasteText} onChange={e => setPasteText(e.target.value)}
          rows={5}
          placeholder={'Amara Diallo\nBen Hartwell\nCleo Nakamura'}
          style={inp}
        />
      </div>

      {/* CSV upload */}
      <div>
        <label style={label}>OR UPLOAD A CSV</label>
        <input
          ref={fileInputRef} type="file" accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
        <button onClick={() => fileInputRef.current?.click()} style={{
          width: '100%', padding: '13px 16px', borderRadius: 12,
          border: `1.5px dashed ${dark ? '#2a4458' : '#c8d8e4'}`,
          background: dark ? '#162535' : '#ffffff',
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        }}>
          {icons.upload('#3d84a8')}
          <span style={{ fontSize: 13, fontWeight: 600, color: dark ? '#e2edf6' : '#1a2b3c' }}>
            {csvFileName ? csvFileName : 'Choose CSV file…'}
          </span>
          {csvNames.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#5bb8a0' }}>{csvNames.length} found</span>
          )}
        </button>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>
          Uses the first column of each row. A header row like "Name" is skipped automatically.
        </p>
      </div>

      {/* Combined preview */}
      {allNames.length > 0 && (
        <div style={{
          padding: '12px 14px', borderRadius: 12,
          background: dark ? '#162535' : '#ffffff',
          border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', marginBottom: 6, letterSpacing: 0.4 }}>
            {allNames.length} STUDENT{allNames.length === 1 ? '' : 'S'} READY TO IMPORT
          </div>
          <div style={{ fontSize: 12, color: dark ? '#e2edf6' : '#1a2b3c', lineHeight: 1.7, fontWeight: 500 }}>
            {allNames.slice(0, 6).join(', ')}{allNames.length > 6 ? `, +${allNames.length - 6} more` : ''}
          </div>
        </div>
      )}

      {error && <p style={{ margin: 0, fontSize: 12, color: '#e8b86d', fontWeight: 600 }}>{error}</p>}

      <button onClick={handleImport} disabled={allNames.length === 0 || importing} style={{
        marginTop: 'auto', width: '100%', padding: '15px', borderRadius: 14,
        background: (allNames.length > 0 && !importing) ? 'linear-gradient(135deg, #3d84a8, #5bb8a0)' : (dark ? '#2a4458' : '#d4e4ef'),
        border: 'none', color: (allNames.length > 0 && !importing) ? 'white' : (dark ? '#4a6880' : '#a0b8c8'),
        fontSize: 16, fontWeight: 700, cursor: (allNames.length > 0 && !importing) ? 'pointer' : 'not-allowed',
      }}>
        {importing ? 'Importing…' : `Import ${allNames.length || ''} student${allNames.length === 1 ? '' : 's'}`}
      </button>
    </div>
  )
}

// ─── Screen: Student Consent ───────────────────────────────────────────────────
// Step 3 of the workflow. Teacher (standing in for each student, or handing
// the device around) records whether each student consents to biometric
// recognition or wants the non-biometric alternative. This is what
// RegistrationScreen checks before it will ever compute a face encoding.
function StudentConsentScreen({ classId, roster, dark, onDone }: {
  classId: number
  roster: RosterStudent[]
  dark: boolean
  onDone: (roster: RosterStudent[]) => void
}) {
  const [students, setStudents] = useState<RosterStudent[]>(roster)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function setConsent(id: number, status: ConsentStatus) {
    setSavingId(id)
    setError(null)
    try {
      await apiPostJson(`/api/students/${id}/consent`, { consent_status: status })
      setStudents(prev => prev.map(s => s.id === id ? { ...s, consent_status: status } : s))
    } catch {
      setError('Could not save that choice. Check the backend connection and try again.')
    } finally {
      setSavingId(null)
    }
  }

  const resolvedCount = students.filter(s => s.consent_status !== 'pending').length

  const choiceBtn = (active: boolean, color: string) => ({
    flex: 1, padding: '8px 6px', borderRadius: 9, fontSize: 11, fontWeight: 700,
    border: `1.5px solid ${active ? color : (dark ? '#2a4458' : '#d4e4ef')}`,
    background: active ? color + '22' : 'transparent',
    color: active ? color : (dark ? '#7aa5c0' : '#6b8ba4'),
    cursor: 'pointer',
  })

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '24px 24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Student consent</h2>
        <p style={{ margin: 0, fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', lineHeight: 1.6, fontWeight: 500 }}>
          {resolvedCount}/{students.length} recorded. Students who choose "Non-biometric" or are left pending will use manual roll-call instead of face recognition.
        </p>
      </div>

      {error && <p style={{ margin: 0, fontSize: 12, color: '#e8b86d', fontWeight: 600 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {students.map(s => (
          <div key={s.id} style={{
            padding: '12px 14px', borderRadius: 14,
            background: dark ? '#162535' : '#ffffff',
            border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
            opacity: savingId === s.id ? 0.6 : 1,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c', marginBottom: 8 }}>{s.name}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button disabled={savingId === s.id} onClick={() => setConsent(s.id, 'biometric')}
                style={choiceBtn(s.consent_status === 'biometric', '#5bb8a0')}>
                Biometric
              </button>
              <button disabled={savingId === s.id} onClick={() => setConsent(s.id, 'non_biometric')}
                style={choiceBtn(s.consent_status === 'non_biometric', '#e8b86d')}>
                Non-biometric
              </button>
              <button disabled={savingId === s.id} onClick={() => setConsent(s.id, 'pending')}
                style={choiceBtn(s.consent_status === 'pending', '#8fa8c8')}>
                Ask later
              </button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => onDone(students)} style={{
        marginTop: 'auto', width: '100%', padding: '15px', borderRadius: 14,
        background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
        border: 'none', color: 'white', fontSize: 16, fontWeight: 700, cursor: 'pointer',
      }}>
        Continue to class
      </button>
    </div>
  )
}

// ─── Screen: Home Dashboard ───────────────────────────────────────────────────
function HomeScreen({ onNav, onScreen, dark, professorName, classYear, periodLabel }: {
  onNav: (t: NavTab) => void; onScreen: (s: Screen) => void; dark: boolean;
  professorName: string; classYear: ClassYear; periodLabel: string
}) {
  const bg = (h: string, tl: string) => `linear-gradient(135deg, ${h}, ${tl})`
  const quickActions = [
    { label: 'Register\nStudent', icon: icons.user, gradient: bg('#3d84a8', '#5ca8c8'), screen: 'registration' as Screen },
    { label: 'Take\nAttendance', icon: icons.camera, gradient: bg('#5bb8a0', '#4aa090'), screen: 'attendance' as Screen },
    { label: 'Start Mood\nMonitor', icon: icons.smile, gradient: bg('#8fa8c8', '#7090b8'), screen: 'mood' as Screen },
    { label: 'View\nReports', icon: icons.chart, gradient: bg('#b8a0c8', '#9880b0'), screen: 'reports' as Screen },
  ]

  const displayName = professorName || 'Professor'
  const initials = professorName
    ? professorName.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')
    : 'P'

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600 }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>
            {getTimeGreeting()}, Professor {displayName}
          </h2>
        </div>
        <div style={{
          width: 40, height: 40, borderRadius: 20,
          background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 15, fontWeight: 800,
        }}>{initials}</div>
      </div>

      {/* Today's snapshot */}
      <div style={{
        padding: '18px', borderRadius: 20,
        background: dark ? '#162535' : '#ffffff',
        border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.5, marginBottom: 14 }}>
          TODAY'S SNAPSHOT — {classYear} · {periodLabel}
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
// Now class-scoped: the teacher picks a student from the roster (filtered
// to those who gave biometric consent and don't yet have a face saved)
// instead of typing a free-text name. This is what lets the backend refuse
// to compute an encoding for anyone who chose non-biometric or is pending.
function RegistrationScreen({ onBack, dark, classId, roster, onRegistered }: {
  onBack: () => void
  dark: boolean
  classId: number | null
  roster: RosterStudent[]
  onRegistered: (studentId: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [capturedBlobs, setCapturedBlobs] = useState<Blob[]>([])
  const [step, setStep] = useState<'name' | 'capture' | 'review' | 'saving' | 'done'>('name')
  const [error, setError] = useState<string | null>(null)
  const total = 15

  const eligible = roster.filter(s => s.consent_status === 'biometric' && !s.face_registered)
  const selected = roster.find(s => s.id === selectedId) || null

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
    if (!selected) return
    setStep('saving')
    const form = new FormData()
    form.append('name', selected.name)
    if (classId != null) form.append('class_id', String(classId))
    form.append('student_id', String(selected.id))
    capturedBlobs.forEach((blob, i) => form.append('images', blob, `angle_${i}.jpg`))
    try {
      await apiPost('/api/students/register', form)
      onRegistered(selected.id)
      setStep('done')
    } catch (e) {
      setError('Failed to save. Check that the backend is running and this student has biometric consent recorded.')
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

      {classId == null ? (
        <p style={{ fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4' }}>
          No class is active yet — go through class setup from the home screen first.
        </p>
      ) : eligible.length === 0 ? (
        <p style={{ fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', lineHeight: 1.6 }}>
          No students are waiting on face registration. Everyone with biometric consent already has a face saved,
          or no one has chosen "Biometric" yet in student consent.
        </p>
      ) : (
        <>
          <label style={{ fontSize: 12, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4' }}>
            SELECT STUDENT ({eligible.length} awaiting registration)
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {eligible.map(s => (
              <button key={s.id} onClick={() => setSelectedId(s.id)} style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 12,
                border: `1.5px solid ${selectedId === s.id ? '#3d84a8' : (dark ? '#2a4458' : '#d4e4ef')}`,
                background: selectedId === s.id ? (dark ? '#1a2e40' : '#eef4fb') : (dark ? '#162535' : '#ffffff'),
                cursor: 'pointer', fontSize: 14, fontWeight: 600, color: dark ? '#e2edf6' : '#1a2b3c',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {icons.fingerprint(selectedId === s.id ? '#3d84a8' : (dark ? '#7aa5c0' : '#6b8ba4'))}
                {s.name}
              </button>
            ))}
          </div>
          <button onClick={() => selectedId && setStep('capture')} disabled={!selectedId} style={{
            padding: '15px', borderRadius: 14,
            background: selectedId ? 'linear-gradient(135deg, #3d84a8, #5bb8a0)' : (dark ? '#2a4458' : '#d4e4ef'),
            border: 'none', color: 'white', fontSize: 16, fontWeight: 700,
            cursor: selectedId ? 'pointer' : 'not-allowed',
          }}>Start capture</button>
        </>
      )}
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
          <p style={{ margin: 0, fontSize: 12, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>{selected?.name}</p>
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
// Now class-scoped (class_id sent on start) and includes the review queue:
// uncertain matches accumulate from /api/attendance/frame and are resolved
// here via /api/attendance/review-correct -- confirm as the best guess, pick
// a different roster name, or dismiss as "not present".
type UncertainMatch = { name: string; confidence: number }

function AttendanceScreen({ onBack, dark, classId, roster }: {
  onBack: () => void
  dark: boolean
  classId: number | null
  roster: RosterStudent[]
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [presentStudents, setPresentStudents] = useState<Set<string>>(new Set())
  const [uncertainQueue, setUncertainQueue] = useState<UncertainMatch[]>([])
  const [reviewOpen, setReviewOpen] = useState(false)
  const [correctingName, setCorrectingName] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)       // prevents overlapping requests
  const stoppedRef = useRef(false)    // stops the loop cleanly on unmount/end

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
      if (classId != null) form.append('class_id', String(classId))
      const data = await apiPost('/api/attendance/start', form)
      setSessionId(data.session_id)
    }
    init()
    return () => { stream?.getTracks().forEach(t => t.stop()); stoppedRef.current = true }
  }, [classId])

  // 2. Timer for the on-screen clock
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 3. Self-scheduling capture loop — only sends the next frame after the
  // previous one finishes, so slow requests (Render free tier) never pile up.
  // Also downscales to max 480px wide before sending, which is both faster
  // to upload and faster for dlib to encode server-side.
  useEffect(() => {
    if (!sessionId) return
    stoppedRef.current = false

    async function captureAndSendLoop() {
      while (!stoppedRef.current) {
        if (!busyRef.current) {
          busyRef.current = true
          await captureOnce()
          busyRef.current = false
        }
        await new Promise(r => setTimeout(r, 1200)) // pacing between attempts
      }
    }

    async function captureOnce() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.videoWidth === 0) return

      const scale = Math.min(1, 480 / video.videoWidth)
      canvas.width = video.videoWidth * scale
      canvas.height = video.videoHeight * scale
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)

      const blob: Blob | null = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.8)
      )
      if (!blob) return

      const form = new FormData()
      form.append('session_id', sessionId!)
      form.append('image', blob, 'frame.jpg')
      try {
        const result = await apiPost('/api/attendance/frame', form)
        if (result.newly_marked?.length) {
          setPresentStudents(prev => {
            const next = new Set(prev)
            result.newly_marked.forEach((n: string) => next.add(n))
            return next
          })
        }
        if (result.uncertain_queue) {
          setUncertainQueue(result.uncertain_queue)
        }
      } catch (e) { /* skip failed frame, loop tries again next tick */ }
    }

    captureAndSendLoop()
    return () => { stoppedRef.current = true }
  }, [sessionId])

  async function resolveUncertain(originalName: string, correctedName: string | null) {
    if (!sessionId) return
    try {
      const result = await apiPostJson('/api/attendance/review-correct', {
        session_id: sessionId,
        original_name: originalName,
        corrected_name: correctedName,
      })
      setUncertainQueue(result.uncertain || [])
      if (result.marked) setPresentStudents(new Set(result.marked))
    } catch {
      setError('Could not save that correction — try again.')
    } finally {
      setCorrectingName(null)
    }
  }

  async function handleEnd() {
    stoppedRef.current = true
    if (sessionId) {
      const form = new FormData()
      form.append('session_id', sessionId)
      await apiPost('/api/attendance/end', form)
    }
    onBack()
  }

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const rosterNamesForCorrection = roster.map(s => s.name)

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {uncertainQueue.length > 0 && (
              <button onClick={() => setReviewOpen(true)} style={{
                background: 'rgba(232,184,109,0.85)', border: 'none', borderRadius: 10, padding: '5px 10px',
                color: '#3a2c0a', fontSize: 12, fontWeight: 800, cursor: 'pointer', backdropFilter: 'blur(8px)',
              }}>
                {uncertainQueue.length} to review
              </button>
            )}
            <div style={{
              background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: '5px 12px',
              color: 'white', fontSize: 12, fontWeight: 700, backdropFilter: 'blur(8px)',
            }}>
              {presentStudents.size}
            </div>
          </div>
        </div>

        {/* Review queue overlay */}
        {reviewOpen && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(10,21,32,0.88)', zIndex: 10,
            display: 'flex', flexDirection: 'column', padding: '50px 16px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ color: 'white', fontSize: 15, fontWeight: 800 }}>Review uncertain matches</span>
              <button onClick={() => setReviewOpen(false)} style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8,
                padding: '5px 10px', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>Close</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {uncertainQueue.length === 0 && (
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', marginTop: 30 }}>
                  All caught up — nothing left to review.
                </p>
              )}
              {uncertainQueue.map(u => (
                <div key={u.name} style={{ background: 'rgba(22,37,53,0.95)', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>Best guess: {u.name}</span>
                    <span style={{ color: '#e8b86d', fontSize: 12, fontWeight: 700 }}>{u.confidence}% confident</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: correctingName === u.name ? 8 : 0 }}>
                    <button onClick={() => resolveUncertain(u.name, u.name)} style={{
                      flex: 1, padding: '8px', borderRadius: 9, border: 'none',
                      background: '#5bb8a0', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>Confirm</button>
                    <button onClick={() => setCorrectingName(correctingName === u.name ? null : u.name)} style={{
                      flex: 1, padding: '8px', borderRadius: 9, border: '1.5px solid rgba(255,255,255,0.3)',
                      background: 'transparent', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>Correct</button>
                    <button onClick={() => resolveUncertain(u.name, null)} style={{
                      flex: 1, padding: '8px', borderRadius: 9, border: '1.5px solid rgba(255,255,255,0.3)',
                      background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}>Not present</button>
                  </div>
                  {correctingName === u.name && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
                      {rosterNamesForCorrection.filter(n => n !== u.name).map(n => (
                        <button key={n} onClick={() => resolveUncertain(u.name, n)} style={{
                          textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 'none',
                          background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>{n}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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

// ─── Live insight helper (Mood Monitor) ───────────────────────────────────────
// Rule-based, not model-based, same "state only what's actually in the data"
// philosophy as the AI Weekly Report narrative on the backend.
type LiveInsight = { text: string; tone: 'good' | 'warn' | 'neutral' }

function computeLiveInsight(points: { t: string; engagement: number }[]): LiveInsight | null {
  if (points.length < 4) return null
  const recent = points.slice(-3)
  const prior = points.slice(-6, -3)
  if (prior.length === 0) return null
  const avg = (arr: typeof points) => arr.reduce((a, b) => a + b.engagement, 0) / arr.length
  const delta = avg(recent) - avg(prior)
  if (delta <= -8) return { text: 'Engagement dipping over the last few minutes — might be a good moment for a quick break or change of pace.', tone: 'warn' }
  if (delta >= 8) return { text: 'Engagement climbing — the class is settling into focus.', tone: 'good' }
  return { text: 'Engagement holding steady this session.', tone: 'neutral' }
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

  // Live Engagement Timeline + Insight: a short rolling buffer that gets
  // flushed into a labeled point every 5s, independent of frame cadence,
  // so the sparkline reads smoothly regardless of network jitter.
  const windowBufferRef = useRef<number[]>([])
  const timelineRef = useRef<{ t: string; engagement: number }[]>([])
  const sessionStartRef = useRef<number | null>(null)

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
      sessionStartRef.current = Date.now()
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

            // Live Engagement Timeline: exclude unresolved "Unknown" faces so
            // an unrecognized person in frame can't skew the class engagement
            // number. Matches the exclusion mood_detection.py's
            // _record_live_engagement() already applies server-side, and the
            // same rule main.py's /api/reports/summary and /api/reports/weekly
            // use for historical aggregates.
            if (f.name !== 'Unknown') {
              windowBufferRef.current.push(f.cognitive_load)
            }
          }
          forceUpdate(n => n + 1)
        } catch { /* skip failed frame */ }
      }, 'image/jpeg', 0.8)
    }, 700)
    return () => clearInterval(interval)
  }, [sessionId])

  // 4. Live Engagement Timeline flush — every 5s, turn the rolling load
  // buffer into one labeled engagement point. Uses wall-clock elapsed time
  // (not the `seconds` state) so the label is accurate even though this
  // interval is only created once per session.
  useEffect(() => {
    if (!sessionId) return
    const flush = setInterval(() => {
      const buf = windowBufferRef.current
      if (buf.length === 0) return
      const avgLoadInWindow = buf.reduce((a, b) => a + b, 0) / buf.length
      const engagement = Math.max(0, Math.round(100 - avgLoadInWindow))
      const elapsed = sessionStartRef.current ? Math.round((Date.now() - sessionStartRef.current) / 1000) : 0
      const mins = Math.floor(elapsed / 60)
      const secs = elapsed % 60
      const label = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      timelineRef.current = [...timelineRef.current, { t: label, engagement }].slice(-24)
      windowBufferRef.current = []
      forceUpdate(n => n + 1)
    }, 5000)
    return () => clearInterval(flush)
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
  const liveInsight = !isCalibrating ? computeLiveInsight(timelineRef.current) : null

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
          padding: '10px 16px 12px', backdropFilter: 'blur(12px)',
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

          {/* Live Engagement Timeline + Insight */}
          {!isCalibrating && timelineRef.current.length >= 2 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4 }}>
                  LIVE ENGAGEMENT
                </span>
              </div>
              <div style={{ height: 42 }}>
                <ResponsiveContainer width="100%" height={42}>
                  <LineChart data={timelineRef.current} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                    <Line type="monotone" dataKey="engagement" stroke="#5bb8a0" strokeWidth={2}
                      dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {liveInsight && (
                <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 4, flexShrink: 0,
                    background: liveInsight.tone === 'warn' ? '#e8b86d' : liveInsight.tone === 'good' ? '#5bb8a0' : '#8fa8c8',
                  }} />
                  <span style={{ fontSize: 11, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>
                    {liveInsight.text}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Screen: Reports ──────────────────────────────────────────────────────────
function ReportsScreen({ onStudent, onWeekly, dark }: { onStudent: (s: any) => void; onWeekly: () => void; dark: boolean }) {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>Reports</h2>
          <p style={{ margin: 0, fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 500 }}>All sessions</p>
        </div>
        <button onClick={onWeekly} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '9px 14px', borderRadius: 12,
          background: 'linear-gradient(135deg, #3d84a8, #5bb8a0)',
          border: 'none', cursor: 'pointer',
        }}>
          {icons.sparkle('white')}
          <span style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>AI Weekly</span>
        </button>
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

// ─── Screen: AI Weekly Report ──────────────────────────────────────────────────
function WeeklyReportScreen({ onBack, dark }: { onBack: () => void; dark: boolean }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet('/api/reports/weekly')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const card = { padding: '16px', borderRadius: 16, background: dark ? '#162535' : '#ffffff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}` }
  const sectionLabel = { margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: dark ? '#7aa5c0' : '#6b8ba4', letterSpacing: 0.4 } as const

  return (
    <div className="phone-scroll" style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          {icons.chevronLeft(dark ? '#e2edf6' : '#1a2b3c')}
        </button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: dark ? '#e2edf6' : '#1a2b3c' }}>AI Weekly Report</h2>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', textAlign: 'center', marginTop: 20 }}>Generating report…</p>
      ) : !data || !data.available ? (
        <p style={{ fontSize: 13, color: dark ? '#7aa5c0' : '#6b8ba4', textAlign: 'center', marginTop: 20 }}>
          Not enough session data yet to build a weekly report. Run a few Mood Monitor sessions first.
        </p>
      ) : (
        <>
          {/* Narrative summary */}
          <div style={{
            ...card,
            background: dark ? 'linear-gradient(135deg,#152a3a,#12251f)' : 'linear-gradient(135deg,#eef8f5,#deedf8)',
            border: `1.5px solid ${dark ? '#2a4458' : '#c8eae0'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              {icons.sparkle(dark ? '#8ecfba' : '#3a8870')}
              <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: dark ? '#8ecfba' : '#3a8870', letterSpacing: 0.3 }}>
                THIS WEEK AT A GLANCE
              </p>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: dark ? '#e2edf6' : '#1a2b3c', fontWeight: 500 }}>
              {data.narrative}
            </p>
          </div>

          {/* Stat row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Avg Engagement', value: `${data.avgEngagement}%`, color: '#3d84a8' },
              {
                label: 'vs Prior Period',
                value: data.prevAvgEngagement != null
                  ? `${data.avgEngagement - data.prevAvgEngagement >= 0 ? '+' : ''}${data.avgEngagement - data.prevAvgEngagement}%`
                  : '—',
                color: data.prevAvgEngagement != null && data.avgEngagement - data.prevAvgEngagement < 0 ? '#e8b86d' : '#5bb8a0',
              },
              { label: 'Flagged', value: String(data.flaggedCount), color: '#e8b86d' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: '12px 10px', borderRadius: 14, textAlign: 'center', background: dark ? '#162535' : '#ffffff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}` }}>
                <div style={{ fontSize: 15, fontWeight: 800, color, marginBottom: 2 }}>{value}</div>
                <div style={{ fontSize: 10, color: dark ? '#7aa5c0' : '#6b8ba4', fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Daily engagement chart */}
          <div style={card}>
            <p style={sectionLabel}>DAILY ENGAGEMENT THIS WEEK</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={data.dailyEngagement} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#2a4458' : '#e8f0f8'} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: dark ? '#7aa5c0' : '#6b8ba4', fontFamily: 'Manrope' }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: dark ? '#7aa5c0' : '#6b8ba4', fontFamily: 'Manrope' }} />
                <Tooltip contentStyle={{ background: dark ? '#162535' : '#fff', border: `1px solid ${dark ? '#2a4458' : '#d4e4ef'}`, borderRadius: 8, fontSize: 11, fontFamily: 'Manrope' }} />
                <Bar dataKey="avgEngagement" radius={[6, 6, 0, 0]}>
                  {data.dailyEngagement.map((_: any, i: number) => <Cell key={i} fill="#3d84a8" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Most improved / declined */}
          {(data.mostImproved || data.mostDeclined) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.mostImproved && (
                <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, border: '1.5px solid #5bb8a0' }}>
                  {icons.trendUp('#5bb8a0')}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>{data.mostImproved.name}</div>
                    <div style={{ fontSize: 11, color: '#5bb8a0', fontWeight: 600 }}>Most improved · +{Math.round(data.mostImproved.delta)} points</div>
                  </div>
                </div>
              )}
              {data.mostDeclined && (
                <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, border: '1.5px solid #e8b86d' }}>
                  {icons.trendDown('#e8b86d')}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c' }}>{data.mostDeclined.name}</div>
                    <div style={{ fontSize: 11, color: '#e8b86d', fontWeight: 600 }}>Biggest drop · {Math.round(data.mostDeclined.delta)} points</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-student list */}
          <div style={card}>
            <p style={sectionLabel}>STUDENT ENGAGEMENT THIS WEEK</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.students.map((s: any) => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 90, fontSize: 11, fontWeight: 600, color: dark ? '#e2edf6' : '#1a2b3c', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </div>
                  <div style={{ flex: 1, height: 8, borderRadius: 4, background: dark ? '#1a2e40' : '#eef3f8', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 4, width: `${s.engagementAvg}%`, background: s.flag ? 'linear-gradient(90deg,#e8b86d,#d4a050)' : 'linear-gradient(90deg,#3d84a8,#5bb8a0)' }} />
                  </div>
                  <div style={{ width: 34, fontSize: 11, fontWeight: 700, color: dark ? '#e2edf6' : '#1a2b3c', textAlign: 'right' }}>{s.engagementAvg}%</div>
                  {s.flag && icons.flag()}
                </div>
              ))}
            </div>
          </div>
        </>
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

  // Session/login details collected on the login screen — professor name,
  // class year, and the selected class period. These now feed straight
  // into POST /api/classes once the teacher accepts the consent screen.
  const [professorName, setProfessorName] = useState('')
  const [classYear, setClassYear] = useState<ClassYear>(CLASS_YEARS[0])
  const [periodId, setPeriodId] = useState(PERIODS[0].id)
  const periodLabel = PERIODS.find(p => p.id === periodId)?.label ?? PERIODS[0].label

  // Class + roster state, threaded down to RegistrationScreen and
  // AttendanceScreen so both operate on the right class_id.
  const [classId, setClassId] = useState<number | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [creatingClass, setCreatingClass] = useState(false)
  const [classError, setClassError] = useState<string | null>(null)

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

  const handleLoginNext = (details: LoginDetails) => {
    setProfessorName(details.professorName)
    setClassYear(details.classYear)
    setPeriodId(details.periodId)
    setScreen('consent')
  }

  // Teacher accepts the camera/consent notice -> create the SchoolClass row
  // (step 1 of the workflow) -> move on to roster import (step 2).
  async function handleConsentAccept() {
    setCreatingClass(true)
    setClassError(null)
    try {
      const cls = await apiPostJson('/api/classes', {
        professor_name: professorName,
        class_year: classYear,
        period_id: periodId,
        period_label: periodLabel,
      })
      setClassId(cls.class_id)
      setScreen('roster-import')
    } catch {
      setClassError('Could not create the class. Check that the backend is running and try again.')
    } finally {
      setCreatingClass(false)
    }
  }

  function handleRosterImported(imported: RosterStudent[]) {
    setRoster(imported)
    setScreen('student-consent')
  }

  function handleConsentDone(finalRoster: RosterStudent[]) {
    setRoster(finalRoster)
    setScreen('home')
    setNavTab('home')
  }

  function handleStudentRegistered(studentId: number) {
    setRoster(prev => prev.map(s => s.id === studentId ? { ...s, face_registered: true } : s))
  }

  const needsNav = ['home', 'students', 'mood', 'reports', 'report-detail', 'weekly-report', 'student-detail', 'settings'].includes(screen)
  const fullscreen = ['attendance', 'mood'].includes(screen)

  return (
    <PhoneFrame dark={dark}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {screen === 'login' && <LoginScreen dark={dark} onNext={handleLoginNext} />}
        {screen === 'consent' && (
          <ConsentScreen dark={dark} onAccept={handleConsentAccept} creating={creatingClass} error={classError} />
        )}
        {screen === 'roster-import' && classId != null && (
          <RosterImportScreen dark={dark} classId={classId} onImported={handleRosterImported} />
        )}
        {screen === 'student-consent' && classId != null && (
          <StudentConsentScreen dark={dark} classId={classId} roster={roster} onDone={handleConsentDone} />
        )}
        {screen === 'home' && (
          <HomeScreen dark={dark} onNav={handleNav} onScreen={s => setScreen(s)}
            professorName={professorName} classYear={classYear} periodLabel={periodLabel} />
        )}
        {screen === 'registration' && (
          <RegistrationScreen dark={dark} onBack={() => setScreen('home')}
            classId={classId} roster={roster} onRegistered={handleStudentRegistered} />
        )}
        {screen === 'attendance' && (
          <AttendanceScreen dark={dark} onBack={() => setScreen('home')} classId={classId} roster={roster} />
        )}
        {screen === 'mood' && <MoodScreen dark={dark} onBack={() => { setScreen('home'); setNavTab('home') }} />}
        {screen === 'reports' && <ReportsScreen dark={dark} onStudent={s => { setSelectedStudent(s); setScreen('report-detail') }} onWeekly={() => setScreen('weekly-report')} />}
        {screen === 'report-detail' && selectedStudent && <ReportDetailScreen dark={dark} student={selectedStudent} onBack={() => setScreen('reports')} />}
        {screen === 'weekly-report' && <WeeklyReportScreen dark={dark} onBack={() => setScreen('reports')} />}
        {screen === 'students' && <StudentsScreen dark={dark} onStudent={s => { setSelectedStudent(s); setScreen('student-detail') }} />}
        {screen === 'student-detail' && selectedStudent && <StudentDetailScreen dark={dark} student={selectedStudent} onBack={() => setScreen('students')} />}
        {screen === 'settings' && <SettingsScreen dark={dark} onToggleDark={() => setDark(d => !d)} />}
      </div>

      {needsNav && !fullscreen && (
        <BottomNav active={navTab} onNav={handleNav} dark={dark} />
      )}

      {/* Dark mode FAB on login/consent/setup screens */}
      {(screen === 'login' || screen === 'consent' || screen === 'roster-import' || screen === 'student-consent') && (
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
