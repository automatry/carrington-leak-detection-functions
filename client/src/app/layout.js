// app/layout.js
import "./globals.css"; // Keep global styles
import { AuthProvider } from "@/app/context/AuthContext"; // Use alias
import Header from "@/app/components/Header";       // Use alias

// Remove Geist font imports if not used

export const metadata = {
  title: "BACnet Device Monitor",
  description: "Monitor and Manage BACnet Devices via Firestore",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/* Remove font variables from className if fonts aren't loaded */}
      <body className="">
        <AuthProvider>
          <Header />
          {/* Add padding-top in globals.css or a wrapper div if header is fixed */}
          <main style={{ paddingTop: '5rem' }}> {/* Simple way to avoid overlap */}
              {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}