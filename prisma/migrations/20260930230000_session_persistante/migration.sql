-- « Rester connecté » se souvient de lui-même.
--
-- `touchSession` prolonge la session et réécrit le cookie ; il ne peut pas relire le `maxAge` d'un
-- cookie existant, et l'information n'était stockée nulle part. Il reposait donc **toujours** une
-- échéance de 12 h : une personne qui avait laissé « Rester connecté » décoché — sur l'ordinateur d'un
-- ami, par exemple — se retrouvait avec un cookie persistant dès sa première action passé la marge de
-- trente minutes. La seule case qui protège d'un appareil prêté devenait inopérante.
--
-- `DEFAULT false` : les sessions déjà ouvertes gardent le comportement prudent, et aucune n'est coupée.
ALTER TABLE "AuthSession" ADD COLUMN "persistant" BOOLEAN NOT NULL DEFAULT false;
