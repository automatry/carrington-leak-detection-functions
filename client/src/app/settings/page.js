// app/settings/page.js
import AuthGuard from "@/app/components/AuthGuard";
import styles from "@/app/styles/Page.module.css";
// Import components for editing recipients and email config later
// import RecipientManager from "@/components/RecipientManager";
// import EmailConfigForm from "@/components/EmailConfigForm";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <div className={styles.container}>
        <h1>Settings</h1>
        <p>Manage global application settings.</p>

        {/* TODO: Implement Recipient Manager Component */}
        <section>
          <h2>Notification Recipients</h2>
          <p>Add, edit, or remove email and SMS recipients.</p>
          {/* <RecipientManager /> */}
           <p style={{color: "orange", marginTop:"1rem"}}>Recipient management UI not yet implemented.</p>
        </section>

        <hr style={{ margin: '2rem 0', borderColor: 'rgb(var(--card-border-rgb))' }} />

        {/* TODO: Implement Email Config Component */}
        <section>
          <h2>Email Configuration</h2>
          <p>Configure sender email details.</p>
          {/* <EmailConfigForm /> */}
           <p style={{color: "orange", marginTop:"1rem"}}>Email configuration UI not yet implemented.</p>
        </section>
      </div>
    </AuthGuard>
  );
}