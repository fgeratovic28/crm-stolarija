import * as React from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type QuoteEmailProps = {
  customerName: string;
  quoteNumber: string;
  quoteTotal: string;
};

export function QuoteEmail({ customerName, quoteNumber, quoteTotal }: QuoteEmailProps) {
  const appBaseUrl = "https://crm-stolarija.vercel.app";
  const memorandumUrl = `${appBaseUrl}/memorandum.png`;
  return (
    <Html>
      <Head />
      <meta name="color-scheme" content="light" />
      <meta name="supported-color-schemes" content="light" />
      <Preview>Ponuda {quoteNumber} je spremna</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section>
            <img src={memorandumUrl} alt="Termo Plast D.O.O memorandum" style={memorandum} />
            <div style={brandBar} />
            <Text style={greeting}>Pozdrav {customerName},</Text>
            <Text style={paragraph}>
              u prilogu Vam saljemo ponudu za trazenu uslugu.
            </Text>
            <Section style={highlightBox}>
              <Text style={highlightLine}>
                <strong>Broj ponude:</strong> {quoteNumber}
              </Text>
              <Text style={highlightLineLast}>
                <strong>Ukupna vrednost:</strong> {quoteTotal}
              </Text>
            </Section>
            <Text style={paragraph}>
              Za sva dodatna pitanja stojimo Vam na raspolaganju.
            </Text>
            <Text style={signature}>Srdacan pozdrav,<br />Termo Plast D.O.O</Text>
          </Section>
          <Hr style={divider} />
          <Text style={footer}>Ovo je automatski poslata poruka iz CRM sistema.</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#ffffff",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  margin: "0",
  padding: "24px 0",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #cbd7ee",
  borderRadius: "12px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "24px",
  boxShadow: "0 6px 20px rgba(9,30,66,0.08)",
};

const greeting = {
  color: "#1e3a8a",
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px",
  fontWeight: "700",
};

const memorandum = {
  display: "block",
  maxWidth: "100%",
  height: "auto",
  margin: "0 0 18px",
};

const paragraph = {
  color: "#1e40af",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 12px",
};

const signature = {
  color: "#b91c1c",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "20px 0 0",
  fontWeight: "700",
};

const divider = {
  borderColor: "#cddcf5",
  margin: "20px 0 12px",
};

const footer = {
  color: "#475569",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0",
};

const highlightBox = {
  backgroundColor: "#f8fbff",
  border: "1px solid #bfd1f3",
  borderLeft: "4px solid #1d4ed8",
  borderRadius: "10px",
  padding: "12px 14px",
  margin: "0 0 14px",
};

const highlightLine = {
  color: "#1e40af",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 8px",
};

const highlightLineLast = {
  color: "#1e40af",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0",
};

const brandBar = {
  height: "4px",
  background: "linear-gradient(90deg,#c1121f 0%,#c1121f 35%,#1d4ed8 35%,#1d4ed8 100%)",
  borderRadius: "999px",
  margin: "0 0 16px",
};
