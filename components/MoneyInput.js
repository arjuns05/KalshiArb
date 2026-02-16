export default function MoneyInput({ label, value, onChange }) {
  return (
    <div>
      <label>{label}</label>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="100"
      />
    </div>
  );
}
