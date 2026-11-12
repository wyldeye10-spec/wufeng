interface MastheadProps {
  studioOpen: boolean
  onToggleStudio: () => void
}

export function Masthead({ studioOpen, onToggleStudio }: MastheadProps) {
  return (
    <header className="masthead">
      <p className="masthead__meta" aria-hidden="true">
        <span>私 人 卷 宗</span>
        <span className="masthead__meta-line" />
        <span>卷 之 一</span>
      </p>

      <div className="masthead__stage">
        <div className="masthead__heading">
          <h1 className="masthead__title" aria-label="藏锋">
            <span>藏</span>
            <span>锋</span>
          </h1>
          <span className="masthead__ghost" aria-hidden="true">
            锋
          </span>
        </div>

        <div className="masthead__aside">
          <p className="masthead__verse" aria-label="事有始终，念有归处。">
            <span>事有始终</span>
            <span>念有归处。</span>
          </p>
          <button
            type="button"
            className={`masthead__edit${studioOpen ? ' is-active' : ''}`}
            onClick={onToggleStudio}
            aria-label={studioOpen ? '返回卷宗' : '编辑任务'}
            aria-pressed={studioOpen}
          >
            <span className="masthead__edit-face" aria-hidden="true">
              <span className="masthead__edit-chars">{studioOpen ? '阅卷' : '编辑'}</span>
            </span>
          </button>
        </div>
      </div>

      <div className="masthead__rule" aria-hidden="true">
        <span />
      </div>
    </header>
  )
}
