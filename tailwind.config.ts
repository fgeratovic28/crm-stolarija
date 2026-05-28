import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.125rem" }],
        sm: ["0.9375rem", { lineHeight: "1.375rem" }],
        base: ["1.0625rem", { lineHeight: "1.5625rem" }],
        lg: ["1.25rem", { lineHeight: "1.75rem" }],
        xl: ["1.4375rem", { lineHeight: "1.875rem" }],
        "2xl": ["1.6875rem", { lineHeight: "2.125rem" }],
        "3xl": ["2.0625rem", { lineHeight: "2.375rem" }],
        "4xl": ["2.5rem", { lineHeight: "2.75rem" }],
        "5xl": ["3.125rem", { lineHeight: "1.1" }],
      },
      fontWeight: {
        // Slightly heavier defaults app-wide (still uses DM Sans weights from Google Fonts)
        normal: "500",
        medium: "600",
        semibold: "700",
        bold: "800",
      },
      fontFamily: {
        /** DM Sans nema ćirilicu; Noto Sans pokriva srpsku ćirilicu kao drugi clan steka. */
        sans: ['"DM Sans"', '"Noto Sans"', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        /** Boje po Termoplast logotipu: navy „Plast“, crvena „Termo“ (#0B2147 / #C8102E), najtamnija #001F3F */
        termoplast: {
          navy: {
            50: "#EFF2F8",
            100: "#D4DCEA",
            200: "#A8B6D4",
            300: "#7A8FBA",
            400: "#526EA0",
            500: "#3A5588",
            600: "#2A4474",
            700: "#1C3560",
            800: "#122A4E",
            900: "#0B2147",
            950: "#001F3F",
            DEFAULT: "#0B2147",
          },
          red: {
            50: "#FCEBED",
            100: "#F5CCD2",
            200: "#EB9BA7",
            300: "#DE6B7D",
            400: "#D23D52",
            500: "#C8102E",
            600: "#A30D26",
            700: "#7D0A1E",
            800: "#5A0716",
            900: "#3D040F",
            DEFAULT: "#C8102E",
          },
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
          muted: "hsl(var(--sidebar-muted))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindAnimate],
} satisfies Config;
