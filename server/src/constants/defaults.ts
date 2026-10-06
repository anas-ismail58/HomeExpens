import type { PaymentMethodType } from '@prisma/client';

export interface DefaultSubcategory {
  key: string;
  nameAr: string;
  nameEn: string;
}

export interface DefaultCategory {
  key: string;
  nameAr: string;
  nameEn: string;
  icon: string;
  color: string;
  subcategories: DefaultSubcategory[];
}

/** Provisioned for every new family. Keys are stable; names are editable. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    key: 'household', nameAr: 'المنزل', nameEn: 'Household', icon: 'home', color: '#0F6E5B',
    subcategories: [
      { key: 'rent', nameAr: 'الإيجار', nameEn: 'Rent' },
      { key: 'electricity', nameAr: 'الكهرباء', nameEn: 'Electricity' },
      { key: 'water', nameAr: 'المياه', nameEn: 'Water' },
      { key: 'internet', nameAr: 'الإنترنت', nameEn: 'Internet' },
      { key: 'maintenance', nameAr: 'الصيانة', nameEn: 'Maintenance' },
    ],
  },
  {
    key: 'food', nameAr: 'الطعام', nameEn: 'Food', icon: 'utensils', color: '#C97B1A',
    subcategories: [
      { key: 'groceries', nameAr: 'البقالة', nameEn: 'Groceries' },
      { key: 'restaurants', nameAr: 'المطاعم', nameEn: 'Restaurants' },
    ],
  },
  {
    key: 'transportation', nameAr: 'المواصلات', nameEn: 'Transportation', icon: 'car', color: '#2E6CA4',
    subcategories: [
      { key: 'fuel', nameAr: 'الوقود', nameEn: 'Fuel' },
      { key: 'car_maintenance', nameAr: 'صيانة السيارة', nameEn: 'Car maintenance' },
      { key: 'parking', nameAr: 'المواقف', nameEn: 'Parking' },
    ],
  },
  {
    key: 'education', nameAr: 'التعليم', nameEn: 'Education', icon: 'graduation-cap', color: '#6B4FA0',
    subcategories: [
      { key: 'school_fees', nameAr: 'الرسوم الدراسية', nameEn: 'School fees' },
      { key: 'books', nameAr: 'الكتب', nameEn: 'Books' },
      { key: 'courses', nameAr: 'الدورات', nameEn: 'Courses' },
      { key: 'home_tutoring', nameAr: 'الدروس المنزلية', nameEn: 'Home lessons' },
    ],
  },
  {
    key: 'health', nameAr: 'الصحة', nameEn: 'Health', icon: 'heart-pulse', color: '#C2412D',
    subcategories: [
      { key: 'doctor', nameAr: 'الطبيب', nameEn: 'Doctor' },
      { key: 'medicine', nameAr: 'الأدوية', nameEn: 'Medicine' },
      { key: 'dental', nameAr: 'الأسنان', nameEn: 'Dental' },
      { key: 'insurance', nameAr: 'التأمين', nameEn: 'Insurance' },
    ],
  },
  {
    key: 'personal', nameAr: 'شخصي', nameEn: 'Personal', icon: 'user', color: '#8A5A44',
    subcategories: [
      { key: 'clothing', nameAr: 'الملابس', nameEn: 'Clothing' },
      { key: 'shopping', nameAr: 'التسوق', nameEn: 'Shopping' },
      { key: 'personal_care', nameAr: 'العناية الشخصية', nameEn: 'Personal care' },
    ],
  },
  {
    key: 'entertainment', nameAr: 'الترفيه', nameEn: 'Entertainment', icon: 'ticket', color: '#B0477F',
    subcategories: [
      { key: 'subscriptions', nameAr: 'الاشتراكات', nameEn: 'Subscriptions' },
      { key: 'outings', nameAr: 'النزهات', nameEn: 'Outings' },
      { key: 'travel', nameAr: 'السفر', nameEn: 'Travel' },
    ],
  },
  {
    key: 'children', nameAr: 'الأطفال', nameEn: 'Children', icon: 'baby', color: '#2A8C9C',
    subcategories: [
      { key: 'toys', nameAr: 'الألعاب', nameEn: 'Toys' },
      { key: 'pocket_money', nameAr: 'المصروف', nameEn: 'Pocket money' },
      { key: 'activities', nameAr: 'الأنشطة', nameEn: 'Activities' },
    ],
  },
  {
    key: 'other', nameAr: 'أخرى', nameEn: 'Other', icon: 'dots', color: '#6B7378',
    subcategories: [],
  },
];

export const DEFAULT_PAYMENT_METHODS: Array<{
  type: PaymentMethodType;
  nameAr: string;
  nameEn: string;
  isDefault?: boolean;
}> = [
  { type: 'MADA', nameAr: 'مدى', nameEn: 'Mada', isDefault: true },
  { type: 'CASH', nameAr: 'نقدًا', nameEn: 'Cash' },
  { type: 'APPLE_PAY', nameAr: 'Apple Pay', nameEn: 'Apple Pay' },
  { type: 'CREDIT_CARD', nameAr: 'بطاقة ائتمانية', nameEn: 'Credit card' },
  { type: 'DEBIT_CARD', nameAr: 'بطاقة خصم', nameEn: 'Debit card' },
  { type: 'BANK_ACCOUNT', nameAr: 'تحويل بنكي', nameEn: 'Bank transfer' },
  { type: 'OTHER', nameAr: 'أخرى', nameEn: 'Other' },
];
