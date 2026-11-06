import { Seal } from './Seal'

interface SectionBannerProps {
  kind: 'open' | 'done'
}

const COPY = {
  open: {
    sigil: '未',
    title: '未竟之事',
    stamp: '卷',
  },
  done: {
    sigil: '了',
    title: '已了之事',
    stamp: '了',
  },
} as const

export function SectionBanner({ kind }: SectionBannerProps) {
  const { sigil, title, stamp } = COPY[kind]
  return (
    <div className={`banner banner--${kind}`}>
      <span className="banner__sigil" aria-hidden="true">
        <span>{sigil}</span>
      </span>
      <h2 className="banner__title" id={`section-${kind}`}>
        {title}
      </h2>

      <svg
        className="banner__ink"
        viewBox="0 0 120 64"
        preserveAspectRatio="xMaxYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <path className="banner__blade" d="M114 2 84 60" />
        <path className="banner__ink-thread" d="M108 5c-11 14-16 27-15 44" />
        <path className="banner__ink-thread" d="M97 8c-9 13-13 25-13 39" />
        <circle className="banner__ink-dot" cx="81" cy="56" r="1.3" />
      </svg>

      <Seal chars={stamp} className="seal--banner" />
    </div>
  )
}
