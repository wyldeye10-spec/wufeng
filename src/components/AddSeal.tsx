interface AddSealProps {
  onClick: () => void
}

export function AddSeal({ onClick }: AddSealProps) {
  return (
    <button type="button" className="add-seal" onClick={onClick} aria-label="新增事项">
      <span className="add-seal__tip" aria-hidden="true">
        记一笔
      </span>
      <span className="add-seal__face" aria-hidden="true">
        <span className="add-seal__plus">
          <i />
          <i />
        </span>
      </span>
    </button>
  )
}
