/**
 * **Une adresse email qui se coupe là où elle se relit** : après « @ » (et aux traits d'union du
 * domaine, comme tout mot composé), jamais au milieu d'un nom. `break-all` la coupait n'importe où
 * (« prenom.nom@club-d-escri / me.fr ») ; `break-words` ne reste qu'en dernier recours, pour
 * un morceau qui ne tiendrait pas seul sur la ligne.
 */
export function AdresseEmail({ email, className = "" }: { email: string; className?: string }) {
  const arobase = email.lastIndexOf("@");
  if (arobase <= 0) return <span className={`break-words ${className}`}>{email}</span>;
  return (
    <span className={`break-words ${className}`}>
      {email.slice(0, arobase + 1)}
      <wbr />
      {email.slice(arobase + 1)}
    </span>
  );
}
