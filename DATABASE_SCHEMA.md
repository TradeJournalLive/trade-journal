# Database Schema

Initial tables to add when backend persistence is implemented.

- Strategy
- StrategyVersion
- BacktestRun
- BrokerConnection
- RiskProfile
- Signal
- Execution
- Order
- Position
- AlgoTrade
- RiskEvent
- Instrument
- Candle
- OptionCandle
- TradingViewWebhookConfig

Live strategy updates create a new StrategyVersion instead of mutating the live definition.
