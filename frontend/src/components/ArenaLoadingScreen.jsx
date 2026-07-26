export default function ArenaLoadingScreen() {
    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-arena-deep text-ink-muted">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-300" aria-hidden="true" />
            <p role="status" className="font-mono text-xs tracking-[0.25em]">Loading...</p>
        </main>
    );
}
