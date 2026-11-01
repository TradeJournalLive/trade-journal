// Reporting only: never replace the complete SQLite/cloud recovery checkpoint.
function hamsPublicView(snapshot){
  const state=snapshot.state;
  return {viewVersion:1,state:{...state,seen:[],...(state.rulesV2?{rulesV2:{...state.rulesV2,ticks:[],seen:[],decisions:[]}}:{})},
    incidents:snapshot.incidents||[],decisions:snapshot.decisions||[],feedAt:snapshot.feedAt,mark:snapshot.mark,workerStatus:snapshot.workerStatus};
}
module.exports={hamsPublicView};
