"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_router_dom_1 = require("react-router-dom");
require("./App.css");
const menus_1 = require("./components/menus");
const MainContext_1 = require("./contexts/MainContext");
const routers_1 = require("./routers");
function App() {
    return (<MainContext_1.MainContext.Provider value={{ routerOptions: routers_1.routers }}>
      <react_router_dom_1.HashRouter>
        <div className='main-container'>      
          <div className='main-menu'>
              <menus_1.AdminMenu />
          </div>
          <div className='main-content'>
              
                <react_router_dom_1.Routes>
                  {routers_1.routers.map(item => <react_router_dom_1.Route path={item.path} element={item.comp} key={item.path}></react_router_dom_1.Route>)}
                </react_router_dom_1.Routes>
            
              
          </div>
        </div>
      </react_router_dom_1.HashRouter>
    </MainContext_1.MainContext.Provider>);
}
exports.default = App;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiQXBwLnRzeCJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLHVEQUE0RDtBQUM1RCxxQkFBa0I7QUFDbEIsOENBQThDO0FBQzlDLHdEQUFvRDtBQUNwRCx1Q0FBbUM7QUFFbkMsU0FBUyxHQUFHO0lBQ1YsT0FBTyxDQUNMLENBQUMseUJBQVcsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBQyxhQUFhLEVBQUUsaUJBQU8sRUFBRSxDQUFDLENBQ3JEO01BQUEsQ0FBQyw2QkFBVyxBQUFELENBQ1Q7UUFBQSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLENBQzdCO1VBQUEsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FDdEI7Y0FBQSxDQUFDLGlCQUFTLENBQUEsRUFDZDtVQUFBLEVBQUUsR0FBRyxDQUNMO1VBQUEsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FFdkI7O2dCQUFBLENBQUMseUJBQU0sQ0FDTDtrQkFBQSxDQUNFLGlCQUFPLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQSxFQUFFLENBQUMsQ0FBQyx3QkFBSyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsd0JBQUssQ0FBQyxDQUFDLENBRTVGO2dCQUFBLEVBQUUseUJBQU0sQ0FHZDs7O1VBQUEsRUFBRSxHQUFHLENBQ1A7UUFBQSxFQUFFLEdBQUcsQ0FDUDtNQUFBLEVBQUUsNkJBQVUsQ0FDZDtJQUFBLEVBQUUseUJBQVcsQ0FBQyxRQUFRLENBQUMsQ0FDeEIsQ0FBQTtBQUNILENBQUM7QUFFRCxrQkFBZSxHQUFHLENBQUEifQ==