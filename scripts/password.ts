import { hashPassword } from "../server/password";
process.stderr.write(
  "Введите пароль (stdin, ввод в терминале может быть видимым):\n",
);
let value = "";
for await (const chunk of process.stdin) {
  value += chunk.toString();
  if (value.includes("\n")) break;
}
const password = value.trimEnd();
if (password.length < 12)
  throw new Error("Пароль должен содержать минимум 12 символов");
console.log(hashPassword(password));
