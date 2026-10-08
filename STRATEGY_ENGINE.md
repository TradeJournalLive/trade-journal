# Strategy Engine

A strategy is a broker-independent JSON definition. The same definition must run in BACKTEST, PAPER and LIVE. Only the execution environment changes.

## Required Concepts
- Recursive condition tree with AND / OR / NOT.
- Value types: PRICE, INDICATOR, CONSTANT, PREVIOUS_VALUE, REFERENCE, TIME, POSITION, PORTFOLIO.
- Operators: GREATER_THAN, LESS_THAN, CROSS_ABOVE, CROSS_BELOW, BETWEEN, PERCENT_ABOVE, PERCENT_BELOW.
- Indicator registry instead of hardcoded indicator logic.
- Strategy versioning: never edit live versions in place.

## Initial Indicators
SMA, EMA, VWAP, RSI, MACD, ATR, Supertrend, Bollinger Bands, Stochastic, CCI, ROC and Volume SMA.
