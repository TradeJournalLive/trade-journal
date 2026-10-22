#property strict
#property version "1.00"
#property description "Read-only demo XAUUSD quote exporter. No order functions."
input string GoldSymbol="XAUUSD";
ulong sequence=0;
int OnInit()
{
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO) return INIT_FAILED;
   if(StringFind(AccountInfoString(ACCOUNT_SERVER),"VantageMarkets-Demo")<0) return INIT_FAILED;
   if(!SymbolSelect(GoldSymbol,true)) return INIT_FAILED;
   EventSetMillisecondTimer(250);
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer()
{
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)) return;
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO) return;
   if(StringFind(AccountInfoString(ACCOUNT_SERVER),"VantageMarkets-Demo")<0) return;
   MqlTick tick;
   if(!SymbolInfoTick(GoldSymbol,tick) || tick.bid<=0 || tick.ask<tick.bid) return;
   long offset=(long)MathRound((double)(TimeTradeServer()-TimeGMT())/1800.0)*1800;
   double margin=0;
   // Calculation only: this does not submit an order.
   if(!OrderCalcMargin(ORDER_TYPE_BUY,GoldSymbol,0.03,tick.ask,margin)) return;
   double sellMargin=0;
   if(!OrderCalcMargin(ORDER_TYPE_SELL,GoldSymbol,0.03,tick.bid,sellMargin)) return;
   string data=StringFormat("{\"version\":1,\"symbol\":\"%s\",\"server\":\"VantageMarkets-Demo\",\"demo\":true,\"currency\":\"%s\",\"sequence\":%I64u,\"exportedAtMs\":%I64d,\"tickAtMs\":%I64d,\"serverOffsetSeconds\":%I64d,\"bid\":%.8f,\"ask\":%.8f,\"contractSize\":%.8f,\"tickSize\":%.8f,\"volumeMin\":%.8f,\"volumeMax\":%.8f,\"volumeStep\":%.8f,\"margin003\":%.8f,\"leverage\":%I64d}",GoldSymbol,AccountInfoString(ACCOUNT_CURRENCY),++sequence,(long)TimeGMT()*1000,tick.time_msc-offset*1000,offset,tick.bid,tick.ask,SymbolInfoDouble(GoldSymbol,SYMBOL_TRADE_CONTRACT_SIZE),SymbolInfoDouble(GoldSymbol,SYMBOL_TRADE_TICK_SIZE),SymbolInfoDouble(GoldSymbol,SYMBOL_VOLUME_MIN),SymbolInfoDouble(GoldSymbol,SYMBOL_VOLUME_MAX),SymbolInfoDouble(GoldSymbol,SYMBOL_VOLUME_STEP),margin,AccountInfoInteger(ACCOUNT_LEVERAGE));
   data=StringSubstr(data,0,StringLen(data)-1)+StringFormat(",\"sellMargin003\":%.8f}",sellMargin);
   int handle=FileOpen("1to2-gold-quote.tmp",FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(handle==INVALID_HANDLE) return;
   FileWriteString(handle,data); FileFlush(handle); FileClose(handle);
   FileMove("1to2-gold-quote.tmp",FILE_COMMON,"1to2-gold-quote.json",FILE_COMMON|FILE_REWRITE);
}
