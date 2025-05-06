"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routers = void 0;
const apiprofile_1 = require("../pages/apiprofile");
const banner_1 = require("../pages/banner");
const noti_1 = require("../pages/noti");
const users_1 = require("../pages/users");
exports.routers = [
    {
        name: "banner管理",
        path: "/banner",
        comp: <banner_1.Banner />
    },
    {
        name: "公告管理",
        path: "/notification",
        comp: <noti_1.NotiPage />
    },
    {
        name: "用户管理",
        path: "/users",
        comp: <users_1.UserPage />
    },
    {
        name: "接口经费管理",
        path: "/apis",
        comp: <apiprofile_1.ApiProfilePage />
    }
];
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50c3giXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsb0RBQXFEO0FBQ3JELDRDQUF5QztBQUN6Qyx3Q0FBeUM7QUFDekMsMENBQTBDO0FBRTdCLFFBQUEsT0FBTyxHQUFHO0lBQ3JCO1FBQ0UsSUFBSSxFQUFFLFVBQVU7UUFDaEIsSUFBSSxFQUFFLFNBQVM7UUFDZixJQUFJLEVBQUUsQ0FBQyxlQUFNLENBQUMsQUFBRCxFQUFHO0tBQ2pCO0lBQ0Q7UUFDRSxJQUFJLEVBQUUsTUFBTTtRQUNaLElBQUksRUFBRSxlQUFlO1FBQ3JCLElBQUksRUFBRSxDQUFDLGVBQVEsQ0FBQyxBQUFELEVBQUc7S0FDbkI7SUFDRDtRQUNFLElBQUksRUFBQyxNQUFNO1FBQ1gsSUFBSSxFQUFFLFFBQVE7UUFDZCxJQUFJLEVBQUUsQ0FBQyxnQkFBUSxDQUFDLEFBQUQsRUFBRztLQUNuQjtJQUNEO1FBQ0UsSUFBSSxFQUFDLFFBQVE7UUFDYixJQUFJLEVBQUUsT0FBTztRQUNiLElBQUksRUFBRSxDQUFDLDJCQUFjLENBQUEsRUFBRTtLQUN4QjtDQUNGLENBQUEifQ==