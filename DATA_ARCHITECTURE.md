# Data Architecture

Market data must use provider abstractions. Dhan can be first, but the system must not depend permanently on Dhan for all data.

## Pipeline
Provider -> Ingestion -> Normalization -> Validation -> Historical Database -> Backtest Engine.

## Candle Model
`timestamp`, `instrumentId`, `timeframe`, `open`, `high`, `low`, `close`, `volume`, `openInterest`, `source`.

## Instrument Master
Fields include exchange, segment, symbol, tradingSymbol, securityId, instrumentType, underlying, expiry, strike, optionType, lotSize and tickSize.
