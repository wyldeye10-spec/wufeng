interface EmptyStateProps {
  kind: 'open' | 'done'
}

export function EmptyState({ kind }: EmptyStateProps) {
  if (kind === 'done') {
    return (
      <div className="empty empty--done">
        <p>尚无已了之事。</p>
      </div>
    )
  }

  return (
    <div className="empty empty--open">
      <span className="empty__wash" aria-hidden="true" />
      <p>此间暂无未竟之事。</p>
    </div>
  )
}
