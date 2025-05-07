import { useCallback, useState } from "react"
import { useRequest } from "../../components/menus/util"

export const ApiProfilePage = ()=>{
  const [result] = useRequest(()=>{
    return new Promise((resolve)=>{
      setTimeout(()=>{
        resolve({status: 'ok', data: '正常工作'})
      }, 1000)
    })
  })
  const [inputValue, setInputValue] = useState()
  const handleOnChange = useCallback((e:any)=>{
      setInputValue(e.target.value)
  },[]);
  return <div>
    {
      result && result.data
    }
    {
      inputValue  && <div>{inputValue}</div>
    }
    <input onChange={handleOnChange}></input>
    <div style={{width:'500px',height:'500px', background:"blue", display:"grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }} >
    <div style={{width:"100px", height:"100px", background:"red"}}></div>
    <div style={{width:"100px", height:"100px", background:"red"}}></div>
    <div style={{width:"100px", height:"100px", background:"red"}}></div>
    <div style={{width:"100px", height:"100px", background:"red"}}></div>
    <div style={{width:"100px", height:"100px", background:"red"}}></div>
    </div>
  </div>
}