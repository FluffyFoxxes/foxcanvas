/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#20201e",
        cream: "#f6f4ee",
        fox: "#ee6b3b",
        moss: "#47715a",
      },
      boxShadow: { soft: "0 10px 40px rgba(45, 42, 35, .10)" },
    },
  },
  plugins: [],
};
