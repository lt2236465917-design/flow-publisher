import type { ReactNode } from 'react'

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.78)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  borderRadius: 16,
  border: '0.5px solid rgba(255, 255, 255, 0.85)',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.02)',
  padding: '20px 24px',
  marginBottom: 14,
}

export function SectionCard({ children }: { children: ReactNode }) {
  return <div style={cardStyle}>{children}</div>
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Sora', sans-serif",
  fontSize: 13,
  fontWeight: 600,
  color: '#86868b',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 14,
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 style={titleStyle}>{children}</h3>
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'rgba(0, 0, 0, 0.04)',
  margin: '18px 0',
}

export function Divider() {
  return <div style={dividerStyle} />
}

const pageHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  marginBottom: 28,
}

const pageTitleStyle: React.CSSProperties = {
  fontFamily: "'Sora', sans-serif",
  fontSize: 28,
  fontWeight: 700,
  color: '#1d1d1f',
  letterSpacing: '-0.03em',
  marginBottom: 6,
}

const pageSubtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#86868b',
  margin: 0,
}

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: ReactNode }) {
  return (
    <div style={pageHeaderStyle}>
      <div>
        <h1 style={pageTitleStyle}>{title}</h1>
        {subtitle && <p style={pageSubtitleStyle}>{subtitle}</p>}
      </div>
      {extra}
    </div>
  )
}
