import type { CSSProperties } from 'react'

interface SealProps {
  chars: string
  className?: string
  label?: string
  style?: CSSProperties
}

/**
 * 朱印：白文印式样（朱底、纸白字）。
 * 边缘的残缺、墨色不均与纸纹全部由 CSS 叠层完成，不使用任何外部素材。
 */
export function Seal({ chars, className = '', label, style }: SealProps) {
  const characters = Array.from(chars)
  return (
    <span
      className={`seal ${className}`.trim()}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="seal__face">
        <span className="seal__chars">
          {characters.map((char, index) => (
            <span className="seal__char" key={`${char}-${index}`}>
              {char}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}
