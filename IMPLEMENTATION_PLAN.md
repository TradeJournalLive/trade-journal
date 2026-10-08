# Implementation Plan

## Phase 1: Product Shell
- TradingOS navigation and independent Algo panel.
- Distinct screens for Strategy Lab, Trading, Risk, Journal, Analytics, Integrations, Settings and Admin.
- Dhan and TradingView UI scaffolds.

## Phase 2: Core Models
- Strategy JSON schema and condition tree types.
- Indicator registry shell.
- Risk profile model.
- BrokerAdapter contract.

## Phase 3: Persistence
- Supabase tables for strategies, versions, broker connections, risk profiles, signals and executions.
- Encrypted credential storage.

## Phase 4: Engines
- Backtest replay.
- Paper broker.
- Risk engine.
- TradingView webhook API.

## Phase 5: Dhan Live
- Implement DhanBrokerAdapter from official Dhan docs.
- Funds, positions, orders, market data, order updates, exit all and kill switch.
