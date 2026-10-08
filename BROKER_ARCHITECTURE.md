# Broker Architecture

All broker access goes through `BrokerAdapter`. Dhan is the first adapter. Future adapters include Zerodha, Fyers, Angel One and Upstox.

## Adapter Methods
connect, disconnect, getProfile, getFunds, getPositions, getOrders, getTrades, placeOrder, modifyOrder, cancelOrder, exitAll, activateKillSwitch, getOrderStatus, subscribeMarketData and subscribeOrderUpdates.

## Security
Never expose broker credentials to the browser. Store secrets server-side with encryption. Do not scatter Dhan calls in UI components.
