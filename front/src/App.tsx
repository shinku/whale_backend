import { HashRouter, Route, Routes } from 'react-router-dom'
import './App.css'
import { AdminMenu } from './components/menus'
import { MainContext } from './contexts/MainContext'
import { routers } from './routers'

function App() {
  return (
    <MainContext.Provider value={{routerOptions: routers }}>
      <HashRouter >
        <div className='main-container'>      
          <div className='main-menu'>
              <AdminMenu/>
          </div>
          <div className='main-content'>
              
                <Routes>
                  {
                    routers.map(item=> <Route path={item.path} element={item.comp} key={item.path}></Route>)
                  }
                </Routes>
            
              
          </div>
        </div>
      </HashRouter>
    </MainContext.Provider>
  )
}

export default App
