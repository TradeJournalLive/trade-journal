# Backtest Engine

Backtests must replay normalized historical data and apply realistic assumptions.

## Inputs
Strategy version, date range, capital, instrument, timeframe, slippage, brokerage, taxes and execution assumptions.

## Outputs
Net P&L, ROI, win rate, profit factor, expectancy, max drawdown, average trade, consecutive wins/losses, equity curve and drawdown curve.

## Options
Options backtests must use actual historical option contracts. Do not infer option P&L from only the underlying. Once an entry selects a strike, the position remains in that strike until exit.
