import bcrypt from "bcryptjs";
import { SrvRecord } from "dns";

export async function hashpassword(passwrod:string) {
    return bcrypt.hash(passwrod,12);
}

export async function  verifyPassword(password:string, hashedPassword:string) {
    return bcrypt.compare(password,hashedPassword)
}