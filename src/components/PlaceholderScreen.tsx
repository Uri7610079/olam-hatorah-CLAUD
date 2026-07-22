import { Construction } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";

interface PlaceholderScreenProps {
  title: string;
  description?: string;
  builtInStage: string;
}

// מסך placeholder שימושי: כותרת אמיתית + הסבר + ציון השלב שיבנה אותו,
// כדי שברור תמיד מה קיים ומה עדיין לא - בלי להעמיד פנים שהמסך פעיל.
export function PlaceholderScreen({ title, description, builtInStage }: PlaceholderScreenProps) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState
        title="המסך הזה עדיין לא נבנה"
        description={`ייבנה ב${builtInStage}, בהתאם לתוכנית השלבים.`}
        icon={Construction}
      />
    </div>
  );
}
