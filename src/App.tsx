import React, {useState} from 'react';
import logo from './logo.svg';
import './App.css';
import { throws } from 'assert';
import {stringify} from "querystring";
const DIGIT_EXPRESSION: RegExp = /^\d$/;

/*
* code for testing
* "NEG r6, r2
   NEG r4, r2
   ADD r1,r2, r3
   ADDI r5,r1,55
   NOR r5, r1, r3
   MUL r1, r4, r3
   LOAD r2, 20(r3)
   STORE r5, 23(r6)
   BEQ r1, r4, 9
   JAL 50
   RET"
* */

class ResStation {
  name: string;
  busy: boolean;
  pc :number;
  op?: string;
  Vj: number;
  Vk: number;
  Qj: number;
  Qk: number;
  Vi: number;
  A: number;
  Imm: number;
  type:InstType;
  timeRemaining : number;
  executing:boolean;
  forwardignRegiter:number;
  writeBackVal:number;
  constructor (stationName: string){
    this.name=stationName;
    this.executing=false;
    this.pc =0;
    this.busy=false;
    this.op="";
    this.Vj=-1;
    this.Vk=-1;
    this.Qj=-1;
    this.Qk=-1;
    this.Vi=-1;
    this.A=-1;
    this.Imm=0;
    this.timeRemaining =0;
    this.type = InstType.INVALID;
    this.writeBackVal =0;
    this.forwardignRegiter = 0;
  }
}
enum InstType {
  Load,
  Store,
  ADD,
  ADDI,
  BEQ,
  JAL,
  RET,
  NEG,
  NOR,
  MULT,
  INVALID
}


class Instruction{
  instType: InstType;
  pc: number;
  inst :string;
  vi:number;
  vj:number;
  vk:number;
  imm:number;
  exeTime : number;
  started:boolean;
  issue?: boolean;
  execute?: boolean;
  write?: boolean;
  
  constructor (type: InstType, pc: number, inst:string, vi:number, vj:number, vk:number, imm:number){
    this.instType = type;
    this.imm = imm;
    this.vi = vi;
    this.vj = vj;
    this.vk = vk;
    this.inst = inst;
    this.exeTime = (type == InstType.ADD || type == InstType.ADDI || type==InstType.BEQ  )?2 :
                    (type==InstType.Store)?3 :(type==InstType.Load)?4:
                 (type == InstType.MULT) ? 8 : 1;
    this.pc = pc;
    this.issue=false;
    this.execute=false;
    this.write=false;
     this.started= false;
  }



}
enum RegState {
  ADD_ADDI1,
  ADD_ADDI2,
  ADD_ADDI3,
  lOAD1,
  LOAD2,
  STORE1,
  STORE2,
  BEQ,
  JAL_RET,
  MUL,
  NEG,
  NOR,
  READY,

}
class Register {
   station : number;
   RAW:boolean;
   WA:boolean;
   value :number;
   // array : number[];
   constructor(value : number) {
     this.station =0;
     this.value =value;
     this.RAW =false;
     this.WA =false;
     // this.array = [];
   }

}
// 8 regs
let regMap = new Map<number, number>();
var regs : Register[] = [new Register(0) , // const reg only zero value
                        new Register(1) ,
                        new Register(1) ,
                        new Register(1) ,
                        new Register(1) ,
                        new Register(1) ,
                        new Register(1) ,
                        new Register(1) ,];


function rename (x :number):number{
  if (x==0) return x;
  if (x==3) console.log(regMap, regMap.has(x));
  let ans :number = -1;
  if (regMap.has(x)==false) {    // if it is read operand and it is not renamed yet, use new regs to rename it
    ans = freelist(x);
    return ans;
  }
  ans = regMap.get(x) as number;
  return ans;
}

function freelist(x:number): number{
    // check if there is anything that can be freed
    if (x==0) return x;
    let free = -1;
    for (let i=1;i<8;i++){
      if (regs[i].WA==false) { // if reg is not used for renaming already
        free= i;
        break;
      }
    }
    if (free==-1) {
      console.log("no free register");
      return -1;
    }
    regs[free].WA=true;
    regMap.set(x,free);
    return free;
}

var instructions: Instruction[] = [];
var instructionQueue : Instruction[]= [];
let curPc = 0;
const re: RegExp = /([a-zA-Z.]+)\s+([rR]\d)[ ,]+([rR]?\d+)[,(\s+]+([rR]\d+)\)?(?:\s+=\s+(\d+))?/gm;
function parse  (x :string) :[InstType,number,number, number, number] {
  let ans : [InstType,number,number, number,number] = [InstType.INVALID, 0,0,0,0] ;
  let index : number = 0;
  if (x.substring(0,4)=="LOAD") {
    ans[0] = InstType.Load;
    index+=4;
  }
  else if ( x.substring(0,5)=="STORE")  {
    ans[0] = InstType.Store;
    index+=5;
  }
  else if ( x.substring(0,3)=="BEQ")  {
    ans[0] =InstType.BEQ;
    index+=3;
  }

  else if ( x.substring(0,4)=="RET")  {
    ans[0] = InstType.RET;
    index+=4;
  }

  else if( x.substring(0,3)=="JAL")  {
    ans[0] =InstType.JAL;
    index+=3;
  }
  else if( x.substring(0,3)=="ADD" )  {
    ans[0] = (x[3]=='I')?InstType.ADDI : InstType.ADD;
    index +=3 + ((x[3]=='I')?1:0);
  }
  else if( x.substring(0,3)=="NEG" ) {
    ans[0] = InstType.NEG;
    index +=3;
  }
  else if( x.substring(0,3)=="NOR" )  {
    ans[0] = InstType.NOR;
  index+=3;
  }
  else if (x.substring(0,3)=="MUL")  {
    ans[0] = InstType.MULT;
     index+=3;
  }
  else  return ans;

  // extract operands

  if (ans[0]==InstType.RET) { // no operands
    return ans;
  }
  // imm , no operands
  else if (ans[0]== InstType.JAL) {
    index++;
    let temp: string = "";
    for (;index<x.length;index++){
        if (x[index]==',') {
          index++;
          break;
        }
        else temp+= x[index];
    }
    if (temp.length>0)ans[4] = +temp;
    return ans;
  }

  // two operands and imm
  else if (ans[0] == InstType.BEQ ||ans[0] == InstType.ADDI) {
     let r:number = 1;
     let temp:string ="";
     for (;index<x.length;index++){
         if (x[index]==',') {
           ans[r++] = +temp;
           temp="";
         }

         else if (x[index]>='0' && x[index]<='9') temp+=x[index];
     }
     ans[3]= ans[2];
     ans[2] = ans[1];
     ans[4] = +temp;
     return ans;
  }
  // two operands and imm
  else if (ans[0]==InstType.Store || ans[0] == InstType.Load) {
    let temp:string ="";
    for (;index<x.length;index++){
      if (x[index]>='0' && x[index]<='9') temp+=x[index];
      else if (x[index]=='(') {
        ans[4]= +temp;
        temp ="";
      }
      else if (x[index]==')') {
        ans[2]= +temp;
        temp ="";
      }
      else if(x[index]==','){
        ans[1]= +temp;
        temp="";
      }
    }
    if (ans[0]==InstType.Store) {
      ans[3] = ans[2];
      ans [2]= ans[1];
    }
    return ans;
  }
  // arithamtic , three operands or two operands
  else if (ans[0] ==InstType.ADD || ans[0] ==InstType.NOR ||
      ans[0] == InstType.MULT ||ans[0] == InstType.NEG) {
    let r:number = 1;
    let temp:string ="";
    for (;index<x.length;index++){
      if (x[index]>='0' && x[index]<='9') temp+=x[index];
      else if (x[index]==',' ) {
        ans[r++]= +temp;
        temp="";
      }
    }
    ans[r]= +temp;
    return ans;
  }


  return ans;
}
let pcCounter :number = 0;
function readInstructions(code: (string | null | undefined)): Instruction[]{

  if(code !== null && code !== undefined){
    //var inst = code.match(re);
    let tempInst :string = "";
    for (let i = 0; i<code.length ;i++) {
      let val = code[i];
      if (val!="\n")  tempInst += val;
      if (val =="\n" || i==code.length-1)     {
        let x  :[InstType, number, number, number, number] = parse(tempInst);
        let type = x[0], vi = x[1], vj = x[2] , vk = x[3] , imm = x[4];
        instructions.push(new Instruction(type,pcCounter++,tempInst,vi,vj,vk,imm));
        tempInst = "";
      }
    }
  }

  return instructions;
}



interface Props{
  code: string;
  setCode: React.Dispatch<React.SetStateAction<string>>;
  issue : Instruction[];
  setIssue : React.Dispatch<React.SetStateAction<Instruction[]>>
}
const CodeInput: React.FC<Props> = ({code, setCode, issue, setIssue}) => {
  return (
      <div id="inputCode">
        <h1> Enter Code Here </h1>

        <textarea id="instructions" placeholder= "Enter Instructions here" className ="form-control" rows={8} value={code} onChange={(e) => {
          setCode(e.target.value);
        }}></textarea>

        <button className="btn" id="load" onClick={(e) => {

          const target = e.target as Element;

          readInstructions(target.parentNode?.childNodes[1].textContent);
          setIssue(instructions);
          setCode ("");

          //console.log(target.parentNode?.childNodes[1].textContent);
        }}>Load</button>

        <button className="btn" id="delete" onClick={(e) => {
          setCode("");
          instructions = [];
          pcCounter=0;
          clk =0;
          setIssue(instructions);
        }}>Delete</button>

        {/*<button className="btn" id="delete" onClick={() => {*/}
        {/*  Issuer=[];*/}
        {/*  pcCounter =0;*/}
        {/*  setCode ("");*/}
        {/*  setIssue(Issuer);*/}
        {/*}}>Empty Issuer</button>*/}

      </div>
  )
}
let memory:number[]= [];
for (let i =0;i<65536;i++) memory[i]= 0;
for (let i=0;i<=3;i++) memory[i]= i;

var resStations: ResStation[] = [
  new ResStation("Add/AddI 1"),
  new ResStation("Add/AddI 2"),
  new ResStation("Add/AddI 3"),
  new ResStation("Load 1"),
  new ResStation("Load 2"),
  new ResStation("Store 1"),
  new ResStation("Store 2"),
  new ResStation("BEQ"),
  new ResStation("JAL/RET"),
  new ResStation("MULT"),
  new ResStation("NEG"),
  new ResStation("NOR"),
];
function puchInstToQueue(){
    console.log(curPc);
  if (curPc < instructions.length)instructionQueue.push((instructions[curPc]));
}
function issue(clock : number){
  // issue to resstation array
  console.log(instructionQueue.length, clock);
  let ans =0;
  for (let i:number =0; i<instructionQueue.length ;i++) {
    // check for strutural hazard


    if (instructionQueue[i].issue) continue;
    let stationIndex = -1;
    if (instructionQueue[i].instType == InstType.ADD || instructionQueue[i].instType == InstType.ADDI) {
        for (let j:number=2;j>=0;j--){
            if(!resStations[j].busy) {
               stationIndex = j;
             break;
           }
        }
    }
    else if (instructionQueue[i].instType == InstType.NEG && !resStations[10].busy) {
       stationIndex = 10;
    }
    else if (instructionQueue[i].instType == InstType.NOR && !resStations[11].busy) {
      stationIndex = 11;
    }
    else if (instructionQueue[i].instType == InstType.MULT && !resStations[9].busy) {
       stationIndex = 9;
    }
    else if (instructionQueue[i].instType == InstType.Load ){
      if (resStations[3].busy==false) stationIndex = 3;
      else if (resStations[4].busy==false) stationIndex= 4;
    }
    else if (instructionQueue[i].instType==InstType.Store){
      if (resStations[5].busy==false) stationIndex = 5;
      else if (resStations[6].busy==false) stationIndex= 6;
    }
    else if ((instructionQueue[i].instType==InstType.RET|| instructionQueue[i].instType==InstType.JAL )  && resStations[8].busy==false)  {
        stationIndex=8;
        ans =1;
    }
    else if (instructionQueue[i].instType==InstType.BEQ  &&resStations[7].busy==false) {
        stationIndex=7;
        ans =2 ;
    }

    console.log(stationIndex);
    if (stationIndex==-1) continue;
    console.log("stationIndex", stationIndex);


    // before I decide to issue the instruction, I need to see if there is a free register to rename
    // rename the opearnds register
    let opj :number= rename(instructionQueue[i].vj);
    console.log(opj);
    let opk :number = 0;
    if (instructionQueue[i].instType!=InstType.NEG)opk= rename(instructionQueue[i].vk);
    if (opj == -1 || opk == -1) { // we cant issue the instruction yet
      console.log("no free register");
      continue;
    }
    // renaming read operands
    instructionQueue[i].vj = opj;
    console.log(opj);
    // only rename if its not an inst with one read operands
    if (instructionQueue[i].instType!=InstType.NEG)instructionQueue[i].vk = opk;

    // assign name to destination register

    let opi = freelist(instructionQueue[i].vi);
    if (opi == -1){ // nothing free
      continue;
    }
    instructionQueue[i].vi = opi;
    resStations[stationIndex].Vi = instructionQueue[i].vi;
    resStations[stationIndex].busy=true;
    resStations[stationIndex].Imm = instructionQueue[i].imm;
    resStations[stationIndex].timeRemaining =instructionQueue[i].exeTime;
    resStations[stationIndex].type= instructionQueue[i].instType;
    resStations[stationIndex].pc=i;//instructionQueue[i].pc;
    resStations[stationIndex].op =  (instructionQueue[i].instType==InstType.NEG )?"NEG" :
                                      (instructionQueue[i].instType==InstType.MULT )?"MULT" :
                                      (instructionQueue[i].instType==InstType.ADDI )?"ADDI" :
                                      (instructionQueue[i].instType==InstType.ADD )?"ADD" :
                                      (instructionQueue[i].instType==InstType.NOR )?"NOR" :
                                      (instructionQueue[i].instType==InstType.Load )?"LOAD" :
                                      (instructionQueue[i].instType==InstType.Store )?"STORE" :
                                      (instructionQueue[i].instType==InstType.RET )?"RET" :
                                      (instructionQueue[i].instType==InstType.BEQ )?"BEQ" :
                                      (instructionQueue[i].instType==InstType.JAL )?"JAL" : "";


    instructionQueue[i].issue=true;
    regs[instructionQueue[i].vi].RAW= true;
    regs[instructionQueue[i].vi].station=stationIndex;
    // if its writing
    if (regs[instructionQueue[i].vj].RAW==false){
      resStations[stationIndex].Vj = instructionQueue[i].vj;
       regs[instructionQueue[i].vi].station=stationIndex;
    }
    else {
      resStations[stationIndex].Qj = regs[instructionQueue[i].vj].station;
    }
    //
    if (instructionQueue[i].instType==InstType.NEG || instructionQueue[i].instType== InstType.ADDI) continue;

    if (regs[instructionQueue[i].vk].RAW==false){
      resStations[stationIndex].Vk = instructionQueue[i].vk;
      regs[instructionQueue[i].vi].station=stationIndex;
    }
    else {
      resStations[stationIndex].Qk = regs[instructionQueue[i].vk].station;
    }
  }
  return ans;
}
let writeBackVector :number[] = [];
function writeBack (){

  for (let i = 0; i<writeBackVector.length ;i+=3){
    let index = writeBackVector[i];
    let value= writeBackVector[i+1];
    let pc = writeBackVector[i+2];
    regs[index].value= value;
    regs[index].RAW=false;
    instructionQueue[pc].write=true;
  }
  writeBackVector= []; // its reset
}
let Prediction = true;
let resStationPop = 0;
function exe ( ):number {

  // decreasing execution time
  // iterate over resstation, if operands are ready, then, decrease reamaining time

  // iterate over resstations,
  let ans =-1;
  Prediction = true;
  for (let i=0;i<resStations.length;i++){
      if (resStations[i].busy==false) continue;

      if ( resStations[i].Qj==-1 && resStations[i].Qk==-1){ // operands are ready
              resStations[i].executing=true;
              resStations[i].timeRemaining--;
        if ((resStations[i].type==InstType.Load && resStations[i].timeRemaining==2) ||
            resStations[i].type==InstType.Store && resStations[i].timeRemaining==1){
            resStations[i].A=regs[resStations[i].Vj].value+resStations[i].Imm;

        }

        if(resStations[i].timeRemaining==0) {
            let realPc = instructionQueue [resStations[i].pc].pc;
            let pc:number = resStations[i].pc;
            let indexJ :number= resStations[i].Vj;
            let indexK :number=resStations[i].Vk;
            let indexI :number=resStations[i].Vi;
            if (resStations[i].type==InstType.BEQ){
                ans = realPc+1+resStations[i].Imm;
                Prediction =  regs[indexJ].value == regs[indexK].value;
                if (Prediction==false) resStationPop = i;
            }
            if (resStations[i].type==InstType.JAL){

                ans = resStations[i].Imm;
                console.log(ans);
                  // rename R1
                    let r1 = freelist(1);
                    regs[r1].value= curPc;
                }
                else if (resStations[i].type==InstType.RET){
                    let r1 = rename(1);
                    ans = regs[r1].value;
                }


                 resStations[i].busy = false;
                 resStations[i].executing = false;
                 resStations[i].op= "";
                 resStations[i].forwardignRegiter= resStations[i].Vi;

                 instructionQueue[pc].execute= true;
                 regs[resStations[i].Vi].RAW =false;
                 if (resStations[i].type == InstType.NOR) console.log(regs[indexJ].value | regs[indexK].value,  ~(regs[indexJ].value | regs[indexK].value))
                 console.log(i,indexI,indexJ,indexK);
                 let wrtieBackValue = (resStations[i].type == InstType.ADD) ? regs[indexJ].value + regs[indexK].value :
                     (resStations[i].type == InstType.ADDI)?regs[indexJ].value + resStations[i].Imm :
                         (resStations[i].type == InstType.MULT)?regs[indexJ].value * regs[indexK].value :
                             (resStations[i].type == InstType.NEG) ? (~regs[indexJ].value) +1 :
                                 (resStations[i].type == InstType.NOR) ?  ~(regs[indexJ].value | regs[indexK].value) :
                                     (resStations[i].type == InstType.Load)? memory[resStations[i].A]:
                                        (resStations[i].type == InstType.Store)?-1:0;
                  resStations[i].Imm=0;
                  console.log(wrtieBackValue, indexI, indexJ, indexK);
                  if (resStations[i].type==InstType.Load) {
                    console.log(wrtieBackValue, indexI);
                  }
                  console.log(wrtieBackValue);
                  if (wrtieBackValue!=-1){
                    writeBackVector.push(indexI);
                    writeBackVector.push(wrtieBackValue);
                    writeBackVector.push(pc);
                  }
                  else {
                    // update memory
                    memory[resStations[i].A]= regs[indexJ].value;
                    console.log(memory[resStations[i].A]);
                  }
                  resStations[i].A=-1;
                  resStations[i].Vi=resStations[i].Vk= resStations[i].Vj = resStations[i].Qj = resStations[i].Qk = -1;

                 // calc write back value
                 // push write back queue here to update regs
              }
      }

  }

 return ans;
}

function forward(){
  // loop to check if there is anything ready to be forwarded from other resstations
  for (let i=0;i<resStations.length;i++){
    if (resStations[i].busy && resStations[i].Qj!=-1){ // check if vj can be forwared from other station
      let forwarderStationIndex = resStations[i].Qj;
      if (resStations[forwarderStationIndex].executing==false) { // forwarder station finshed executing
        resStations[i].Vj=resStations[forwarderStationIndex].forwardignRegiter;
        console.log("---------",resStations[i].Vj, i);

        resStations[i].Qj =-1;
      }
    }
    if (resStations[i].busy && resStations[i].Qk!=-1){ // check if vj can be forwared from other station
      let forwarderStationIndex = resStations[i].Qk;
      if (resStations[forwarderStationIndex].executing==false) { // forwarder station finshed executing
        resStations[i].Vk=resStations[forwarderStationIndex].forwardignRegiter;
        resStations[i].Qk =-1;
      }
    }
  }
}
let branch = -1;
let jall = 0;
function update (clock : number){
  // now I have resstations
  // regs
  // instructionQueue decoded
  // next step
  console.log("clk : " , clock);
  //writeBac

  // if its not jall, push new instruciton
    // otherwise stall issuing

  if (jall==0||jall==2)puchInstToQueue();
  writeBack();
  branch= exe();
  if (!Prediction) {
      console.log("flush");
      resStations[resStationPop].A=-1;
      resStations[resStationPop].Vi=resStations[resStationPop].Vk= resStations[resStationPop].Vj
          = resStations[resStationPop].Qj = resStations[resStationPop].Qk = -1;
      resStations[resStationPop].busy = false;
      resStations[resStationPop].executing = false;
      resStations[resStationPop].op= "";
      console.log(instructionQueue);
      instructionQueue.pop();
      console.log(instructionQueue);
  }
  jall =issue(clock);  // return 1 if instruciton is jall , 2 if branch is issued
  forward();
  console.log(branch);
    
  if (branch == -1) curPc++;
  else curPc = branch;
  console.log("pc", curPc);
}

let clk = 0;
function App() {
  const [code, setCode] = useState<string>("");
  const [issue, setIssue] = useState <Instruction[]>(instructionQueue);
  const [program,SetProgram]  = useState <Instruction[]>(instructions);
  const [stationPool, setStationPool] = useState < ResStation[]> (resStations);
  const [regFile, setRegFile] = useState < Register[]> (regs);
  return (
      <div className="App">
        <div className="container">

          <CodeInput code={code} setCode={setCode} issue = {program} setIssue={SetProgram}/>

            <h1> Program </h1>
            <table className="table table-bordered table-hover" id="instructionQueue-table, border={1}">
                <thead className="thead-dark">
                <tr>

                    <td>
                        <strong></strong>
                    </td>

                </tr>
                </thead>
                <tbody id="instruction-table">
                {
                    program.map( (val:Instruction ) =>{
                        return (
                            <tr>

                                <td >{val.inst}</td>

                            </tr> )
                    })
                }
                </tbody>
            </table>
          <h1> instructionQueue </h1>
          <table className="table table-bordered table-hover" id="instructionQueue-table, border={1}">
            <thead className="thead-dark">
            <tr>
              <td>
                <strong>PC</strong>
              </td>
              <td>
                <strong>Instruction</strong>
              </td>
              <td>
                <strong>Issue</strong>
              </td>
              <td>
                <strong>Execute</strong>
              </td>
              <td>
                <strong>Write Result</strong>
              </td>
            </tr>
            </thead>
            <tbody id="instruction-table">
            {
              issue.map( (val:Instruction ) =>{
                return (
              <tr>
              <td >{val.pc}</td>
              <td >{val.inst}</td>
              <td >{String(val.issue)}</td>
              <td >{String(val.execute)}</td>
              <td >{String(val.write)}</td>
              </tr> )
            })
            }
            </tbody>
          </table>
          <button className="btn" id="run">Run</button>
          <button className="btn" id="step" onClick = {()=>{

            // check other states not related
            update(clk++);

            console.log(clk);
            const cp3  =code;
            setCode(cp3);
            let copy = instructions;
            setIssue([...instructionQueue]);
            let copy2 = resStations;
            setStationPool( [...resStations]);
            setRegFile([...regs]);
            console.log(resStations);

            // let copy2 = resStations;
            // setStationPool([]);
            // setStationPool(resStations);


            // console.log(copy);
            // console.log(copy2);
          }}>Step  </button>
          <button className="btn" id="prev">Prev</button>
          <button className="btn" id="rst">Reset</button>
          <h1>Reservation Stations</h1>
          <table className="table table-bordered table-hover" border={1}>
            <thead>
            <tr>
              <td>
                <strong>Station Name</strong>
              </td>
              <td>
                <strong>Busy</strong>
              </td>
              <td>
                <strong>Op</strong>
              </td>
              <td>
                <strong>Vj</strong>
              </td>
              <td>
                <strong>Vk</strong>
              </td>
              <td>
                <strong>Qj</strong>
              </td>
              <td>
                <strong>Qk</strong>
              </td>
              <td>
                <strong>Destination</strong>
              </td>
              <td>
                <strong>A</strong>
              </td>
              <td>
                <strong>Immediate</strong>
              </td>
            </tr>
            </thead>
            <tbody id="res-station">
            {
              stationPool.map((station:ResStation) =>{
                return (
                    <tr>
                      <td> {station.name}</td>
                      <td> {String(station.busy)}</td>
                      <td> {station.op}</td>
                      <td> {(station.Vj == -1)?"":station.Vj}</td>
                      <td>  {(station.Vk == -1)?"":station.Vk}</td>
                      <td>  {(station.Qj == -1)?"":station.Qj}</td>
                      <td>  {(station.Qk == -1)?"":station.Qk}</td>
                      <td>  {(station.Vi == -1)?"":station.Vi}</td>
                      <td>  {(station.A==-1)?"": station.A}</td>
                      <td> {station.Imm}</td>
                      <td>{station.timeRemaining}</td>
                    </tr>
                )
              })
            }
            </tbody>
          </table>


          <h1>Register File</h1>
          <table className="table table-bordered table-hover" border={1}>
            <thead>
            <tr>
              <td>
                <strong>R0</strong>
              </td>
              <td>
                <strong>R1</strong>
              </td>
              <td>
                <strong>R2</strong>
              </td>
              <td>
                <strong>R3</strong>
              </td>
              <td>
                <strong>R4</strong>
              </td>
              <td>
                <strong>R5</strong>
              </td>
              <td>
                <strong>R6</strong>
              </td>
              <td>
                <strong>R7</strong>
              </td>

            </tr>
            </thead>
            <tbody id="res-station">
              <tr>
                <td>{regFile[0].value}</td>
                <td>{regFile[1].value}</td>
                <td>{regFile[2].value}</td>
                <td>{regFile[3].value}</td>
                <td>{regFile[4].value}</td>
                <td>{regFile[5].value}</td>
                <td>{regFile[6].value}</td>
                <td>{regFile[7].value}</td>

              </tr>
            </tbody>
          </table>


        </div>

      </div>
  )
}

export default App;
