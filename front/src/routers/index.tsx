import { ApiProfilePage } from "../pages/apiprofile";
import { Banner } from "../pages/banner";
import { NotiPage } from "../pages/noti";
import { UserPage } from "../pages/users";

export const routers = [
  {
    name: "banner管理",
    path: "/banner",
    comp: <Banner />
  },
  {
    name: "公告管理",
    path: "/notification",
    comp: <NotiPage />
  },
  {
    name:"用户管理",
    path: "/users",
    comp: <UserPage />
  },
  {
    name:"接口经费管理",
    path: "/apis",
    comp: <ApiProfilePage/>
  }
]