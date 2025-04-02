import { Menu } from 'antd'
import MenuItem from 'antd/es/menu/MenuItem'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { routers } from '../../routers'
export const AdminMenu = ()=>{
  
  const params = useLocation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(()=>{
    setSelectedIndex(routers.findIndex(item=>item.path === params.pathname))
  },[params])

  return <Menu mode='inline' selectedKeys={[selectedIndex.toString()]}>
        {
          routers.map((item,index)=>
            <MenuItem key={index} >
              <div>
                <Link to={item.path} >{item.name}</Link>
              </div>
            </MenuItem>
          )
        }
  </Menu>
}