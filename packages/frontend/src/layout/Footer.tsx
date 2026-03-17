export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-navy-light/80 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/50">
        <div className="text-center sm:text-left">
          <p className="font-medium text-white/80">Navio Block Explorer</p>
          <p className="text-xs mt-1">Powered by naviod</p>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/navio-io/navio-blocks"
            className="hover:text-white transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href="/docs"
            className="hover:text-white transition-colors"
          >
            API Docs
          </a>
        </div>
      </div>
    </footer>
  );
}
