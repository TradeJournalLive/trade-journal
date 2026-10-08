# TradingOS Architecture

TradingOS lives inside the existing 1to2 Trade Journal Next.js app. The first implementation is an integrated Algo Trading workspace with clear boundaries for strategy, market data, risk, broker execution, journal and analytics.

## Existing Stack
- Framework: Next.js 14 App Router
- Language: TypeScript / React
- Styling: Tailwind plus app CSS
- Database/Auth: Supabase client already present in the journal app
- Deployment: Vercel config present
- Package manager: npm

## Target Modules
- `core/strategy`: broker-independent Strategy JSON and versioning
- `core/indicators`: registry for EMA, VWAP, RSI and later indicators
- `core/risk`: pre-trade checks and kill switch
- `core/execution`: Backtest, Paper and Live execution adapters
- `market-data`: historical/live provider abstractions
- `brokers`: BrokerAdapter plus Dhan adapter first
- `integrations/tradingview`: webhook ingestion and signal normalization
- `journal` and `analytics`: automated trade records and performance analysis
