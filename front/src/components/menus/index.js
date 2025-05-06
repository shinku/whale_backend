"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminMenu = void 0;
const antd_1 = require("antd");
const MenuItem_1 = require("antd/es/menu/MenuItem");
const react_1 = require("react");
const react_router_dom_1 = require("react-router-dom");
const routers_1 = require("../../routers");
const AdminMenu = () => {
    const params = (0, react_router_dom_1.useLocation)();
    const [selectedIndex, setSelectedIndex] = (0, react_1.useState)(0);
    (0, react_1.useEffect)(() => {
        setSelectedIndex(routers_1.routers.findIndex(item => item.path === params.pathname));
    }, [params]);
    return <antd_1.Menu mode='inline' selectedKeys={[selectedIndex.toString()]}>
        {routers_1.routers.map((item, index) => <MenuItem_1.default key={index}>
              <div>
                <react_router_dom_1.Link to={item.path}>{item.name}</react_router_dom_1.Link>
              </div>
            </MenuItem_1.default>)}
  </antd_1.Menu>;
};
exports.AdminMenu = AdminMenu;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50c3giXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsK0JBQTJCO0FBQzNCLG9EQUE0QztBQUM1QyxpQ0FBMkM7QUFDM0MsdURBQW9EO0FBQ3BELDJDQUF1QztBQUNoQyxNQUFNLFNBQVMsR0FBRyxHQUFFLEVBQUU7SUFFM0IsTUFBTSxNQUFNLEdBQUcsSUFBQSw4QkFBVyxHQUFFLENBQUM7SUFDN0IsTUFBTSxDQUFDLGFBQWEsRUFBRSxnQkFBZ0IsQ0FBQyxHQUFHLElBQUEsZ0JBQVEsRUFBQyxDQUFDLENBQUMsQ0FBQztJQUN0RCxJQUFBLGlCQUFTLEVBQUMsR0FBRSxFQUFFO1FBQ1osZ0JBQWdCLENBQUMsaUJBQU8sQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFBLEVBQUUsQ0FBQSxJQUFJLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFBO0lBQzFFLENBQUMsRUFBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUE7SUFFWCxPQUFPLENBQUMsV0FBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUM5RDtRQUFBLENBQ0UsaUJBQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUMsS0FBSyxFQUFDLEVBQUUsQ0FDeEIsQ0FBQyxrQkFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUNuQjtjQUFBLENBQUMsR0FBRyxDQUNGO2dCQUFBLENBQUMsdUJBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsdUJBQUksQ0FDekM7Y0FBQSxFQUFFLEdBQUcsQ0FDUDtZQUFBLEVBQUUsa0JBQVEsQ0FBQyxDQUNaLENBRVQ7RUFBQSxFQUFFLFdBQUksQ0FBQyxDQUFBO0FBQ1QsQ0FBQyxDQUFBO0FBbkJZLFFBQUEsU0FBUyxhQW1CckIifQ==