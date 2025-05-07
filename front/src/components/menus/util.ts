import { useEffect, useState } from "react";

export const useAction = ()=>{
  const [loading, setLoading] = useState(false);
  setTimeout(()=>{
    setLoading(true)
  },1000)
  return [loading]
}


export const useRequest = (fetchCall: Function)=>{
  const [result, setResult] = useState<any>(null);
  fetchCall().then((res:any)=>{
    setResult(res)
  })
  useEffect(()=>{
    return ()=>{
      setResult(null)
    }
  },[])
  return [result]
}
