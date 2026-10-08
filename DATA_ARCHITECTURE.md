# Data Architecture

Market data must use provider abstractions. Dhan can be first, but the system must not depend permanently on Dhan for all data.

## Pipeline
Provider -> Ingestion -> Normalization -> Validation -> Historical Database -> Backtest Engine.

## Candle Model
`timestamp`, `instrumentId`, `timeframe`, `open`, `high`, `low`, `close`, `volume`, `openInterest`, `source`.

## Instrument Master
Fields include exchange, segment, symbol, tradingSymbol, securityId, instrumentType, underlying, expiry, strike, optionType, lotSize and tickSize.


## TradingView Historical Signals

Protected TradingView indicators do not expose historical alert history through webhooks. Historical performance requires one of:
- imported historical signal CSV;
- reproducible Pine logic converted into Strategy DSL;
- another supported historical signal source;
- prospectively collected webhook signals.

Imported signal CSV must validate timestamp, symbol, action, price, timezone, duplicates, missing values and chronological order before conversion into Signal records.
