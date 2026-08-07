'use client'

/**
 * Plain-language explanation of the "I am modelling" switch.
 *
 * The substance comes from the TouchChat modelling-tips sheet ("model without
 * expectation — we are teaching, not testing") and from why the switch exists
 * at all: attribution. An adult demonstrating on the child's board without it
 * would be recorded as the child, which silently corrupts the child's own
 * independence and accuracy figures.
 */
export function ModelingHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modeling-help-title"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modeling-help-title" className="text-2xl font-bold">
          What is modelling?
        </h2>
        <div className="mt-4 space-y-4 text-lg leading-relaxed">
          <p>
            Modelling (aided language input) is how adults teach AAC: press the
            buttons on the child&apos;s own board to show how something is said,
            without asking them to copy you.
          </p>
          <p>
            Model constantly, and model without expectation — keep showing even
            when the child doesn&apos;t respond yet. It is one of the strongest
            predictors of progress. You are teaching, not testing.
          </p>
          <p>
            This switch makes sure <strong>your</strong> presses are recorded as
            the grown-up&apos;s, not the child&apos;s. Without it, an adult
            demonstrating twenty times a session would corrupt the child&apos;s
            own record — their independence, their accuracy, even whether they
            &ldquo;spoke&rdquo; today.
          </p>
          <p>It switches itself off after 90 seconds without an adult press.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-[var(--color-accent)] py-3 text-lg font-semibold text-white"
          style={{ minHeight: 52 }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
