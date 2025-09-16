export interface BillingAccount {
    id: string;
    organizationId: string;
    customerId?: string;
    plan: BillingPlan;
    status: BillingStatus;
    balance: number;
    creditLimit?: number;
    billingCycle: BillingCycle;
    nextBillingDate?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface BillingPlan {
    id: string;
    name: string;
    type: PlanType;
    pricing: PlanPricing;
    features: PlanFeatures;
    limits: PlanLimits;
}

export interface PlanPricing {
    model: PricingModel;
    basePrice?: number;
    perUserPrice?: number;
    perCharacterPrice?: number;
    markup?: number;
    currency: string;
}

export interface PlanFeatures {
    maxUsers?: number;
    maxChannels?: number;
    providers: string[];
    apiAccess: boolean;
    customGlossary: boolean;
    analytics: boolean;
    priority: 'low' | 'normal' | 'high';
    sla?: string;
}

export interface PlanLimits {
    monthlyCharacters?: number;
    dailyRequests?: number;
    maxMessageLength?: number;
    concurrentTranslations?: number;
}

export interface Usage {
    accountId: string;
    period: Date;
    translations: number;
    characters: number;
    cost: number;
    providers: Record<string, ProviderUsage>;
}

export interface ProviderUsage {
    requests: number;
    characters: number;
    tokens?: number;
    cost: number;
}

export interface Invoice {
    id: string;
    accountId: string;
    period: Date;
    dueDate: Date;
    total: number;
    tax?: number;
    status: InvoiceStatus;
    items: InvoiceItem[];
    paidAt?: Date;
}

export interface InvoiceItem {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    metadata?: Record<string, any>;
}

export type BillingStatus = 
    | 'active'
    | 'suspended'
    | 'delinquent'
    | 'cancelled';

export type BillingCycle = 
    | 'monthly'
    | 'quarterly'
    | 'annual'
    | 'custom';

export type PlanType = 
    | 'free'
    | 'starter'
    | 'professional'
    | 'enterprise'
    | 'payg';

export type PricingModel = 
    | 'flat'
    | 'per_user'
    | 'per_character'
    | 'hybrid'
    | 'custom';

export type InvoiceStatus = 
    | 'draft'
    | 'pending'
    | 'paid'
    | 'overdue'
    | 'cancelled';