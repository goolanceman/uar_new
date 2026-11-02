"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, Heart, Users, HandHeart, Package, Truck, Sparkles, FileText, Settings,
  Menu, Bell, Search, Plus, TrendingUp, TrendingDown, DollarSign, Target,
  PackageCheck, Calendar, MapPin, Phone, Mail, Eye, Edit, Trash2, Download,
  MoreVertical, CheckCircle, AlertCircle, Clock, Send, QrCode, Globe, Moon,
  Sun, LogOut, Camera, Upload, X, Printer, Share2, ArrowLeft, Save
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend, AreaChart, Area } from "recharts";

// ==================== TYPES ====================
type UserRole = "admin" | "volunteer" | "donor" | "beneficiary";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
}

interface Donation {
  id: string;
  donorName: string;
  donorEmail: string;
  donorPhone?: string;
  amount: number;
  category: string;
  type: "one_time" | "recurring";
  paymentMethod: string;
  status: "completed" | "pending" | "failed";
  date: string;
  campaign?: string;
  message?: string;
  receiptNumber?: string;
}

interface Campaign {
  id: string;
  title: string;
  description: string;
  category: string;
  targetAmount: number;
  raisedAmount: number;
  startDate: string;
  endDate?: string;
  location?: string;
  status: "active" | "completed" | "draft" | "paused";
  donors: number;
}

interface Beneficiary {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  category: string;
  location: string;
  urgency: "low" | "medium" | "high" | "critical";
  familyMembers: number;
  monthlyIncome?: number;
  needs: string[];
  status: "active" | "inactive";
  lastHelped?: string;
  notes?: string;
}

interface Volunteer {
  id: string;
  name: string;
  email: string;
  phone: string;
  skills: string[];
  area: string;
  status: "active" | "inactive" | "pending";
  tasksCompleted: number;
  joinedDate: string;
  emergencyContact?: string;
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  minStock: number;
  unit: string;
  pricePerUnit?: number;
  status: "in_stock" | "low_stock" | "out_of_stock";
}

interface Distribution {
  id: string;
  type: string;
  beneficiaries: number;
  location: string;
  date: string;
  volunteer: string;
  status: "completed" | "scheduled" | "in_progress";
  items: string[];
  notes?: string;
}

// ==================== MOCK DATA ====================
const mockUser: User = {
  id: "1",
  name: "Admin User",
  email: "admin@unitedangelreach.org",
  phone: "+91 9876543210",
  role: "admin",
};

const mockStats = {
  totalDonations: 1250000,
  monthlyDonations: 185000,
  beneficiaries: 2450,
  activeCampaigns: 12,
  volunteers: 156,
  inventoryItems: 3200,
};

const donationTrendData = [
  { month: "Jan", amount: 95000, donors: 45 },
  { month: "Feb", amount: 120000, donors: 52 },
  { month: "Mar", amount: 180000, donors: 78 },
  { month: "Apr", amount: 150000, donors: 65 },
  { month: "May", amount: 165000, donors: 70 },
  { month: "Jun", amount: 185000, donors: 82 },
];

const categoryData = [
  { name: "Food Distribution", value: 45, color: "oklch(0.55 0.15 145)" },
  { name: "Education Support", value: 25, color: "oklch(0.65 0.12 145)" },
  { name: "Sanitary Pads", value: 18, color: "oklch(0.45 0.18 145)" },
  { name: "Medical Aid", value: 12, color: "oklch(0.75 0.08 145)" },
];

const initialDonations: Donation[] = [
  { id: "1", donorName: "Rahul Sharma", donorEmail: "rahul@email.com", donorPhone: "+91 9876512345", amount: 5000, category: "Food Distribution", type: "one_time", paymentMethod: "UPI", status: "completed", date: "2024-01-15", receiptNumber: "UAR-2024-001234" },
  { id: "2", donorName: "Priya Patel", donorEmail: "priya@email.com", donorPhone: "+91 9876512346", amount: 2500, category: "Education Support", type: "recurring", paymentMethod: "Razorpay", status: "completed", date: "2024-01-14", receiptNumber: "UAR-2024-001235" },
  { id: "3", donorName: "Mohammed Khan", donorEmail: "mohammed@email.com", donorPhone: "+91 9876512347", amount: 10000, category: "Sanitary Pads", type: "one_time", paymentMethod: "Bank Transfer", status: "pending", date: "2024-01-14", receiptNumber: "UAR-2024-001236" },
  { id: "4", donorName: "Anita Devi", donorEmail: "anita@email.com", donorPhone: "+91 9876512348", amount: 1500, category: "General", type: "one_time", paymentMethod: "Cash", status: "completed", date: "2024-01-13", receiptNumber: "UAR-2024-001237" },
  { id: "5", donorName: "Suresh Kumar", donorEmail: "suresh@email.com", donorPhone: "+91 9876512349", amount: 3000, category: "Food Distribution", type: "recurring", paymentMethod: "UPI", status: "completed", date: "2024-01-12", receiptNumber: "UAR-2024-001238" },
];

const initialCampaigns: Campaign[] = [
  { id: "1", title: "Ramadan Food Drive 2024", description: "Distribute food kits to 500 families during Ramadan month. Each kit contains rice, dal, oil, sugar, and other essential items for a family of 4 for a week.", category: "Food Distribution", targetAmount: 500000, raisedAmount: 375000, startDate: "2024-03-01", endDate: "2024-04-15", location: "Bangalore, Karnataka", status: "active", donors: 245 },
  { id: "2", title: "Girls Education Initiative", description: "Support education for 100 underprivileged girls by providing school supplies, uniforms, and tuition fees for one academic year.", category: "Education Support", targetAmount: 300000, raisedAmount: 280000, startDate: "2024-01-01", endDate: "2024-06-30", location: "Multiple Locations", status: "active", donors: 189 },
  { id: "3", title: "Sanitary Pads for Schools", description: "Provide sanitary pads to 50 schools in rural areas and conduct awareness sessions on menstrual hygiene for teenage girls.", category: "Sanitary Pads", targetAmount: 200000, raisedAmount: 200000, startDate: "2024-01-01", endDate: "2024-03-31", location: "Rural Karnataka", status: "completed", donors: 156 },
  { id: "4", title: "Winter Clothing Drive", description: "Distribute warm clothes and blankets to homeless families and elderly people during winter season.", category: "General", targetAmount: 150000, raisedAmount: 45000, startDate: "2024-11-01", location: "North Karnataka", status: "draft", donors: 23 },
];

const initialBeneficiaries: Beneficiary[] = [
  { id: "1", name: "Fatima Begum", phone: "+91 9876523451", email: "fatima@email.com", address: "Village Panchayat, Bannerghatta Road", category: "Widow", location: "Bangalore Rural", urgency: "high", familyMembers: 4, monthlyIncome: 5000, needs: ["Food", "Education"], status: "active", lastHelped: "2024-01-10", notes: "Has two school-going children" },
  { id: "2", name: "Ramesh Kumar", phone: "+91 9876523452", email: "ramesh@email.com", address: "Gandhi Nagar, Near Railway Station", category: "Disabled", location: "Mysore", urgency: "critical", familyMembers: 2, monthlyIncome: 3000, needs: ["Medical", "Food"], status: "active", lastHelped: "2024-01-08", notes: "Requires regular medical attention" },
  { id: "3", name: "Lakshmi Devi", phone: "+91 9876523453", email: "lakshmi@email.com", address: "Tumkur Road, Near Bus Stand", category: "Single Mother", location: "Tumkur", urgency: "medium", familyMembers: 3, monthlyIncome: 8000, needs: ["Education", "Food"], status: "active", lastHelped: "2024-01-05", notes: "Works as domestic helper" },
  { id: "4", name: "Mohammed Irfan", phone: "+91 9876523454", category: "Orphan", location: "Bangalore Urban", urgency: "high", familyMembers: 1, needs: ["Education", "Shelter"], status: "active", lastHelped: "2024-01-12", notes: "Living in orphanage, needs educational support" },
  { id: "5", name: "Sunita Sharma", phone: "+91 9876523455", email: "sunita@email.com", address: "Hubli Old Town", category: "Elderly", location: "Hubli", urgency: "low", familyMembers: 1, monthlyIncome: 4000, needs: ["Medical"], status: "inactive", lastHelped: "2023-12-15", notes: "Has moved to live with relatives" },
];

const initialVolunteers: Volunteer[] = [
  { id: "1", name: "Arjun Reddy", email: "arjun@email.com", phone: "+91 9876543211", skills: ["Distribution", "Driving"], area: "Bangalore North", status: "active", tasksCompleted: 45, joinedDate: "2023-06-15", emergencyContact: "+91 9876543200" },
  { id: "2", name: "Sneha Gupta", email: "sneha@email.com", phone: "+91 9876543212", skills: ["Teaching", "Counseling"], area: "Mysore", status: "active", tasksCompleted: 32, joinedDate: "2023-08-20", emergencyContact: "+91 9876543201" },
  { id: "3", name: "Vikram Singh", email: "vikram@email.com", phone: "+91 9876543213", skills: ["Medical Aid", "First Aid"], area: "Bangalore South", status: "active", tasksCompleted: 28, joinedDate: "2023-09-10", emergencyContact: "+91 9876543202" },
  { id: "4", name: "Divya Nair", email: "divya@email.com", phone: "+91 9876543214", skills: ["Administration", "Event Management"], area: "Bangalore Central", status: "pending", tasksCompleted: 0, joinedDate: "2024-01-05", emergencyContact: "+91 9876543203" },
];

const initialInventory: InventoryItem[] = [
  { id: "1", name: "Rice (5kg pack)", category: "Food Kit", quantity: 450, minStock: 100, unit: "packs", pricePerUnit: 350, status: "in_stock" },
  { id: "2", name: "Sanitary Pads (pack of 10)", category: "Sanitary Pads", quantity: 850, minStock: 200, unit: "packs", pricePerUnit: 50, status: "in_stock" },
  { id: "3", name: "School Notebooks", category: "Education Material", quantity: 1200, minStock: 300, unit: "pieces", pricePerUnit: 25, status: "in_stock" },
  { id: "4", name: "Dal (1kg pack)", category: "Food Kit", quantity: 85, minStock: 100, unit: "packs", pricePerUnit: 120, status: "low_stock" },
  { id: "5", name: "Cooking Oil (1L)", category: "Food Kit", quantity: 0, minStock: 50, unit: "bottles", pricePerUnit: 150, status: "out_of_stock" },
];

const initialDistributions: Distribution[] = [
  { id: "1", type: "Food Kit", beneficiaries: 50, location: "Bangalore Rural", date: "2024-01-15", volunteer: "Arjun Reddy", status: "completed", items: ["Rice", "Dal", "Oil"], notes: "Successfully distributed to 50 families" },
  { id: "2", type: "Sanitary Pads", beneficiaries: 120, location: "Govt School, Mysore", date: "2024-01-14", volunteer: "Sneha Gupta", status: "completed", items: ["Sanitary Pads", "Awareness Session"], notes: "Conducted awareness session for 100 girls" },
  { id: "3", type: "Education Material", beneficiaries: 30, location: "Tumkur Village", date: "2024-01-16", volunteer: "Vikram Singh", status: "scheduled", items: ["Notebooks", "Pens", "Books"], notes: "Scheduled for next week" },
  { id: "4", type: "Food Kit", beneficiaries: 25, location: "Hubli Slum Area", date: "2024-01-17", volunteer: "Arjun Reddy", status: "in_progress", items: ["Rice", "Dal", "Vegetables"], notes: "Distribution in progress" },
];

const padDistributionData = [
  { month: "Jan", schools: 12, girls: 450, sessions: 8 },
  { month: "Feb", schools: 15, girls: 520, sessions: 10 },
  { month: "Mar", schools: 18, girls: 680, sessions: 12 },
  { month: "Apr", schools: 20, girls: 750, sessions: 15 },
  { month: "May", schools: 22, girls: 820, sessions: 18 },
  { month: "Jun", schools: 25, girls: 950, sessions: 20 },
];

// ==================== UTILITY FUNCTIONS ====================
const generateId = () => `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const generateReceiptNumber = () => `UAR-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

// ==================== COMPONENTS ====================

// Sidebar Navigation
function SidebarNav({ activeTab, setActiveTab, isOpen, setIsOpen }: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "donations", label: "Donations", icon: Heart },
    { id: "campaigns", label: "Campaigns", icon: Target },
    { id: "beneficiaries", label: "Beneficiaries", icon: Users },
    { id: "volunteers", label: "Volunteers", icon: HandHeart },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "distributions", label: "Distributions", icon: Truck },
    { id: "sanitary-pads", label: "Sanitary Pads", icon: Sparkles },
    { id: "reports", label: "Reports", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setIsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 h-screen sticky top-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Heart className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-bold text-lg">United Angel</h1>
                <p className="text-xs text-sidebar-foreground/70">Reach Trust</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <ScrollArea className="flex-1 p-3">
            <nav className="space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setIsOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === item.id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </button>
              ))}
            </nav>
          </ScrollArea>

          {/* User info */}
          <div className="p-4 border-t border-sidebar-border">
            <div className="flex items-center gap-3">
              <Avatar className="w-9 h-9">
                <AvatarFallback className="bg-primary text-primary-foreground">{mockUser.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{mockUser.name}</p>
                <p className="text-xs text-sidebar-foreground/70 capitalize">{mockUser.role}</p>
              </div>
              <Button variant="ghost" size="icon" className="text-sidebar-foreground/70 hover:text-sidebar-foreground">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar */}
      <aside
        className={`fixed lg:hidden inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Heart className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-bold text-lg">United Angel</h1>
                <p className="text-xs text-sidebar-foreground/70">Reach Trust</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <ScrollArea className="flex-1 p-3">
            <nav className="space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setIsOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === item.id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </button>
              ))}
            </nav>
          </ScrollArea>

          {/* User info */}
          <div className="p-4 border-t border-sidebar-border">
            <div className="flex items-center gap-3">
              <Avatar className="w-9 h-9">
                <AvatarFallback className="bg-primary text-primary-foreground">{mockUser.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{mockUser.name}</p>
                <p className="text-xs text-sidebar-foreground/70 capitalize">{mockUser.role}</p>
              </div>
              <Button variant="ghost" size="icon" className="text-sidebar-foreground/70 hover:text-sidebar-foreground">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// Stats Card
function StatsCard({ title, value, change, icon: Icon, trend }: {
  title: string;
  value: string | number;
  change?: string;
  icon: React.ElementType;
  trend?: "up" | "down";
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {change && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${trend === "up" ? "text-green-600" : "text-red-600"}`}>
                {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {change}
              </div>
            )}
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Dashboard Component
function Dashboard({ setActiveTab }: { setActiveTab: (tab: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-muted-foreground">Welcome back, {mockUser.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"><Calendar className="w-4 h-4 mr-2" />Jan 2024</Button>
          <Button size="sm"><Download className="w-4 h-4 mr-2" />Export</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Donations" value={`₹${(mockStats.totalDonations / 100000).toFixed(1)}L`} change="+12.5%" icon={DollarSign} trend="up" />
        <StatsCard title="Beneficiaries" value={mockStats.beneficiaries.toLocaleString()} change="+85" icon={Users} trend="up" />
        <StatsCard title="Active Campaigns" value={mockStats.activeCampaigns} icon={Target} />
        <StatsCard title="Volunteers" value={mockStats.volunteers} change="+12" icon={HandHeart} trend="up" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Donation Trends</CardTitle><CardDescription>Monthly donation amount</CardDescription></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={donationTrendData}>
                <defs><linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="oklch(0.55 0.15 145)" stopOpacity={0.3}/><stop offset="95%" stopColor="oklch(0.55 0.15 145)" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0 0)" />
                <XAxis dataKey="month" stroke="oklch(0.5 0 0)" fontSize={12} />
                <YAxis stroke="oklch(0.5 0 0)" fontSize={12} tickFormatter={(value) => `₹${value/1000}k`} />
                <Tooltip contentStyle={{ backgroundColor: "oklch(1 0 0)", border: "1px solid oklch(0.9 0 0)", borderRadius: "8px" }} formatter={(value: number) => [`₹${value.toLocaleString()}`, "Amount"]} />
                <Area type="monotone" dataKey="amount" stroke="oklch(0.55 0.15 145)" fillOpacity={1} fill="url(#colorAmount)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Donation Categories</CardTitle><CardDescription>Distribution by category</CardDescription></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value">
                  {categoryData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div><CardTitle>Recent Donations</CardTitle><CardDescription>Latest donation activities</CardDescription></div>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("donations")}>View All</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {initialDonations.slice(0, 4).map((donation) => (
                <div key={donation.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Avatar><AvatarFallback>{donation.donorName.charAt(0)}</AvatarFallback></Avatar>
                    <div><p className="font-medium">{donation.donorName}</p><p className="text-xs text-muted-foreground">{donation.category}</p></div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">₹{donation.amount.toLocaleString()}</p>
                    <Badge variant={donation.status === "completed" ? "default" : "secondary"} className="text-xs">{donation.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full justify-start" variant="outline" onClick={() => setActiveTab("donations")}><Plus className="w-4 h-4 mr-2" />Add Donation</Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setActiveTab("beneficiaries")}><Users className="w-4 h-4 mr-2" />Add Beneficiary</Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setActiveTab("distributions")}><Truck className="w-4 h-4 mr-2" />New Distribution</Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setActiveTab("campaigns")}><Target className="w-4 h-4 mr-2" />Create Campaign</Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setActiveTab("reports")}><FileText className="w-4 h-4 mr-2" />Generate Report</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20"><AlertCircle className="h-4 w-4 text-yellow-600" /><AlertTitle>Low Inventory Alert</AlertTitle><AlertDescription>3 items are running low on stock. Check inventory for details.</AlertDescription></Alert>
        <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20"><CheckCircle className="h-4 w-4 text-green-600" /><AlertTitle>Distribution Completed</AlertTitle><AlertDescription>Food kit distribution at Bangalore Rural completed successfully.</AlertDescription></Alert>
      </div>
    </div>
  );
}

// ==================== DONATIONS MODULE ====================
function DonationsModule() {
  const [donations, setDonations] = useState<Donation[]>(initialDonations);
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selectedDonation, setSelectedDonation] = useState<Donation | null>(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [formData, setFormData] = useState<Partial<Donation>>({});

  const filteredDonations = filterCategory === "all" ? donations : donations.filter(d => d.category.toLowerCase().includes(filterCategory));

  const handleAdd = () => {
    const newDonation: Donation = {
      id: generateId(),
      donorName: formData.donorName || "",
      donorEmail: formData.donorEmail || "",
      donorPhone: formData.donorPhone || "",
      amount: formData.amount || 0,
      category: formData.category || "General",
      type: formData.type || "one_time",
      paymentMethod: formData.paymentMethod || "UPI",
      status: "pending",
      date: new Date().toISOString().split("T")[0],
      message: formData.message,
      receiptNumber: generateReceiptNumber(),
    };
    setDonations([newDonation, ...donations]);
    setShowForm(false);
    setFormData({});
    toast.success("Donation added successfully!");
  };

  const handleEdit = () => {
    if (!selectedDonation) return;
    setDonations(donations.map(d => d.id === selectedDonation.id ? { ...d, ...formData } : d));
    setShowEdit(false);
    setFormData({});
    toast.success("Donation updated successfully!");
  };

  const handleDelete = () => {
    if (!selectedDonation) return;
    setDonations(donations.filter(d => d.id !== selectedDonation.id));
    setShowDelete(false);
    setSelectedDonation(null);
    toast.success("Donation deleted successfully!");
  };

  const openView = (donation: Donation) => { setSelectedDonation(donation); setShowView(true); };
  const openEdit = (donation: Donation) => { setSelectedDonation(donation); setFormData(donation); setShowEdit(true); };
  const openDelete = (donation: Donation) => { setSelectedDonation(donation); setShowDelete(true); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Donations</h2><p className="text-muted-foreground">Manage all donations and donors</p></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"><QrCode className="w-4 h-4 mr-2" />Scan QR</Button>
          <Button size="sm" onClick={() => { setFormData({}); setShowForm(true); }}><Plus className="w-4 h-4 mr-2" />Add Donation</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Today's Donations" value="₹45,500" icon={DollarSign} trend="up" change="+15%" />
        <StatsCard title="This Week" value="₹2,85,000" icon={TrendingUp} trend="up" change="+8%" />
        <StatsCard title="This Month" value={`₹${(mockStats.monthlyDonations/1000).toFixed(0)}k`} icon={Calendar} />
        <StatsCard title="Total Donors" value="1,245" icon={Users} trend="up" change="+32" />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Input placeholder="Search donations..." className="flex-1" />
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="food">Food Distribution</SelectItem>
                <SelectItem value="education">Education Support</SelectItem>
                <SelectItem value="sanitary">Sanitary Pads</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Donor</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDonations.map((donation) => (
                  <TableRow key={donation.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8"><AvatarFallback>{donation.donorName.charAt(0)}</AvatarFallback></Avatar>
                        <div><p className="font-medium">{donation.donorName}</p><p className="text-xs text-muted-foreground">{donation.donorEmail}</p></div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant="outline">{donation.category}</Badge></TableCell>
                    <TableCell className="font-bold text-primary">₹{donation.amount.toLocaleString()}</TableCell>
                    <TableCell className="hidden md:table-cell"><Badge variant="secondary">{donation.type === "one_time" ? "One-time" : "Recurring"}</Badge></TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">{donation.date}</TableCell>
                    <TableCell><Badge variant={donation.status === "completed" ? "default" : donation.status === "pending" ? "secondary" : "destructive"}>{donation.status}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openView(donation)}><Eye className="w-4 h-4 mr-2" />View Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(donation)}><Edit className="w-4 h-4 mr-2" />Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast.success(`Receipt ${donation.receiptNumber} downloaded!`)}><Download className="w-4 h-4 mr-2" />Download Receipt</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast.success("Thank you email sent!")}><Send className="w-4 h-4 mr-2" />Send Thank You</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600" onClick={() => openDelete(donation)}><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Add Donation Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add New Donation</DialogTitle><DialogDescription>Record a new donation to the system</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Donor Name</Label><Input placeholder="Full name" value={formData.donorName || ""} onChange={(e) => setFormData({ ...formData, donorName: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input placeholder="+91 XXXXX XXXXX" value={formData.donorPhone || ""} onChange={(e) => setFormData({ ...formData, donorPhone: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" placeholder="email@example.com" value={formData.donorEmail || ""} onChange={(e) => setFormData({ ...formData, donorEmail: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Amount (₹)</Label><Input type="number" placeholder="1000" value={formData.amount || ""} onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Food Distribution">Food Distribution</SelectItem>
                    <SelectItem value="Education Support">Education Support</SelectItem>
                    <SelectItem value="Sanitary Pads">Sanitary Pads</SelectItem>
                    <SelectItem value="General">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Type</Label>
                <Select value={formData.type} onValueChange={(v: "one_time" | "recurring") => setFormData({ ...formData, type: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="one_time">One-time</SelectItem><SelectItem value="recurring">Recurring</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Payment Method</Label>
                <Select value={formData.paymentMethod} onValueChange={(v) => setFormData({ ...formData, paymentMethod: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UPI">UPI</SelectItem><SelectItem value="Razorpay">Razorpay</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem><SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Message (Optional)</Label><Textarea placeholder="Any special message..." rows={2} value={formData.message || ""} onChange={(e) => setFormData({ ...formData, message: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add Donation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Donation Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Donation Details</DialogTitle></DialogHeader>
          {selectedDonation && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <Avatar className="w-12 h-12"><AvatarFallback className="text-lg">{selectedDonation.donorName.charAt(0)}</AvatarFallback></Avatar>
                <div><p className="font-bold text-lg">{selectedDonation.donorName}</p><p className="text-sm text-muted-foreground">{selectedDonation.donorEmail}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label className="text-muted-foreground">Amount</Label><p className="font-bold text-2xl text-primary">₹{selectedDonation.amount.toLocaleString()}</p></div>
                <div><Label className="text-muted-foreground">Status</Label><p><Badge variant={selectedDonation.status === "completed" ? "default" : "secondary"}>{selectedDonation.status}</Badge></p></div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label className="text-muted-foreground">Category</Label><p>{selectedDonation.category}</p></div>
                <div><Label className="text-muted-foreground">Type</Label><p>{selectedDonation.type === "one_time" ? "One-time" : "Recurring"}</p></div>
                <div><Label className="text-muted-foreground">Payment Method</Label><p>{selectedDonation.paymentMethod}</p></div>
                <div><Label className="text-muted-foreground">Date</Label><p>{selectedDonation.date}</p></div>
                <div><Label className="text-muted-foreground">Phone</Label><p>{selectedDonation.donorPhone || "N/A"}</p></div>
                <div><Label className="text-muted-foreground">Receipt No.</Label><p className="font-mono text-xs">{selectedDonation.receiptNumber}</p></div>
              </div>
              {selectedDonation.message && (<div><Label className="text-muted-foreground">Message</Label><p className="text-sm mt-1">{selectedDonation.message}</p></div>)}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => toast.success(`Receipt downloaded!`)}><Download className="w-4 h-4 mr-2" />Receipt</Button>
            <Button variant="outline" onClick={() => toast.success("Email sent!")}><Send className="w-4 h-4 mr-2" />Send Email</Button>
            <Button onClick={() => { setShowView(false); openEdit(selectedDonation!); }}><Edit className="w-4 h-4 mr-2" />Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Donation Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Donation</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Donor Name</Label><Input value={formData.donorName || ""} onChange={(e) => setFormData({ ...formData, donorName: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={formData.donorPhone || ""} onChange={(e) => setFormData({ ...formData, donorPhone: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.donorEmail || ""} onChange={(e) => setFormData({ ...formData, donorEmail: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Amount (₹)</Label><Input type="number" value={formData.amount || ""} onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Status</Label>
                <Select value={formData.status} onValueChange={(v: "completed" | "pending" | "failed") => setFormData({ ...formData, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="completed">Completed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Donation</DialogTitle><DialogDescription>Are you sure you want to delete this donation? This action cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== CAMPAIGNS MODULE ====================
function CampaignsModule() {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [formData, setFormData] = useState<Partial<Campaign>>({});

  const handleAdd = () => {
    const newCampaign: Campaign = {
      id: generateId(),
      title: formData.title || "",
      description: formData.description || "",
      category: formData.category || "General",
      targetAmount: formData.targetAmount || 0,
      raisedAmount: 0,
      startDate: formData.startDate || new Date().toISOString().split("T")[0],
      endDate: formData.endDate,
      location: formData.location,
      status: "draft",
      donors: 0,
    };
    setCampaigns([newCampaign, ...campaigns]);
    setShowForm(false);
    setFormData({});
    toast.success("Campaign created successfully!");
  };

  const handleEdit = () => {
    if (!selectedCampaign) return;
    setCampaigns(campaigns.map(c => c.id === selectedCampaign.id ? { ...c, ...formData } : c));
    setShowEdit(false);
    setFormData({});
    toast.success("Campaign updated successfully!");
  };

  const handleDelete = () => {
    if (!selectedCampaign) return;
    setCampaigns(campaigns.filter(c => c.id !== selectedCampaign.id));
    setShowDelete(false);
    setSelectedCampaign(null);
    toast.success("Campaign deleted successfully!");
  };

  const openView = (campaign: Campaign) => { setSelectedCampaign(campaign); setShowView(true); };
  const openEdit = (campaign: Campaign) => { setSelectedCampaign(campaign); setFormData(campaign); setShowEdit(true); };
  const openDelete = (campaign: Campaign) => { setSelectedCampaign(campaign); setShowDelete(true); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Campaigns</h2><p className="text-muted-foreground">Manage fundraising campaigns</p></div>
        <Button size="sm" onClick={() => { setFormData({}); setShowForm(true); }}><Plus className="w-4 h-4 mr-2" />Create Campaign</Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {campaigns.map((campaign) => (
          <Card key={campaign.id} className="overflow-hidden">
            <div className="h-32 gradient-hero relative">
              <div className="absolute inset-0 bg-black/20" />
              <div className="absolute bottom-4 left-4">
                <Badge variant={campaign.status === "active" ? "default" : campaign.status === "completed" ? "secondary" : "outline"}>{campaign.status}</Badge>
              </div>
            </div>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{campaign.title}</CardTitle>
              <CardDescription className="line-clamp-2">{campaign.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Progress</span><span className="font-medium">{Math.round((campaign.raisedAmount / campaign.targetAmount) * 100)}%</span></div>
                <Progress value={(campaign.raisedAmount / campaign.targetAmount) * 100} className="h-2" />
                <div className="flex justify-between text-sm"><span className="font-bold text-primary">₹{campaign.raisedAmount.toLocaleString()}</span><span className="text-muted-foreground">of ₹{campaign.targetAmount.toLocaleString()}</span></div>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="w-4 h-4" />{campaign.donors} donors</span>
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />{campaign.endDate ? `Ends ${campaign.endDate}` : "Ongoing"}</span>
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => openView(campaign)}><Eye className="w-4 h-4 mr-1" />View</Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(campaign)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
              <Button size="sm" className="flex-1" onClick={() => toast.success("Thank you for your interest!")}><Heart className="w-4 h-4 mr-1" />Donate</Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Create Campaign Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create New Campaign</DialogTitle><DialogDescription>Start a new fundraising campaign</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Campaign Title</Label><Input placeholder="Enter campaign title" value={formData.title || ""} onChange={(e) => setFormData({ ...formData, title: e.target.value })} /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea placeholder="Describe the campaign..." rows={3} value={formData.description || ""} onChange={(e) => setFormData({ ...formData, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Target Amount (₹)</Label><Input type="number" placeholder="100000" value={formData.targetAmount || ""} onChange={(e) => setFormData({ ...formData, targetAmount: parseFloat(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Food Distribution">Food Distribution</SelectItem>
                    <SelectItem value="Education Support">Education Support</SelectItem>
                    <SelectItem value="Sanitary Pads">Sanitary Pads</SelectItem>
                    <SelectItem value="Medical Aid">Medical Aid</SelectItem>
                    <SelectItem value="General">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={formData.startDate || ""} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} /></div>
              <div className="space-y-2"><Label>End Date (Optional)</Label><Input type="date" value={formData.endDate || ""} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Location</Label><Input placeholder="Campaign location" value={formData.location || ""} onChange={(e) => setFormData({ ...formData, location: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Create Campaign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Campaign Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{selectedCampaign?.title}</DialogTitle></DialogHeader>
          {selectedCampaign && (
            <div className="space-y-4">
              <div className="h-40 gradient-hero rounded-lg relative">
                <div className="absolute inset-0 bg-black/20 rounded-lg" />
                <div className="absolute bottom-4 left-4"><Badge variant={selectedCampaign.status === "active" ? "default" : "secondary"}>{selectedCampaign.status}</Badge></div>
              </div>
              <p className="text-muted-foreground">{selectedCampaign.description}</p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Progress</span><span className="font-medium">{Math.round((selectedCampaign.raisedAmount / selectedCampaign.targetAmount) * 100)}%</span></div>
                <Progress value={(selectedCampaign.raisedAmount / selectedCampaign.targetAmount) * 100} className="h-2" />
                <div className="flex justify-between text-sm"><span className="font-bold text-primary">₹{selectedCampaign.raisedAmount.toLocaleString()}</span><span className="text-muted-foreground">of ₹{selectedCampaign.targetAmount.toLocaleString()}</span></div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label className="text-muted-foreground">Category</Label><p>{selectedCampaign.category}</p></div>
                <div><Label className="text-muted-foreground">Location</Label><p>{selectedCampaign.location || "N/A"}</p></div>
                <div><Label className="text-muted-foreground">Start Date</Label><p>{selectedCampaign.startDate}</p></div>
                <div><Label className="text-muted-foreground">End Date</Label><p>{selectedCampaign.endDate || "Ongoing"}</p></div>
                <div><Label className="text-muted-foreground">Total Donors</Label><p>{selectedCampaign.donors}</p></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => toast.success("Campaign link copied!")}><Share2 className="w-4 h-4 mr-2" />Share</Button>
            <Button variant="outline" onClick={() => { setShowView(false); openEdit(selectedCampaign!); }}><Edit className="w-4 h-4 mr-2" />Edit</Button>
            <Button onClick={() => toast.success("Thank you!")}><Heart className="w-4 h-4 mr-2" />Donate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Campaign Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Campaign Title</Label><Input value={formData.title || ""} onChange={(e) => setFormData({ ...formData, title: e.target.value })} /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea rows={3} value={formData.description || ""} onChange={(e) => setFormData({ ...formData, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Target Amount (₹)</Label><Input type="number" value={formData.targetAmount || ""} onChange={(e) => setFormData({ ...formData, targetAmount: parseFloat(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Status</Label>
                <Select value={formData.status} onValueChange={(v: "active" | "completed" | "draft" | "paused") => setFormData({ ...formData, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="paused">Paused</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Location</Label><Input value={formData.location || ""} onChange={(e) => setFormData({ ...formData, location: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Campaign</DialogTitle><DialogDescription>Are you sure you want to delete this campaign? This action cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== BENEFICIARIES MODULE ====================
function BeneficiariesModule() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>(initialBeneficiaries);
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiary | null>(null);
  const [formData, setFormData] = useState<Partial<Beneficiary>>({});
  const [needsInput, setNeedsInput] = useState<string[]>([]);

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case "critical": return "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/20";
      case "high": return "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/20";
      case "medium": return "text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20";
      default: return "text-green-600 bg-green-50 border-green-200 dark:bg-green-950/20";
    }
  };

  const handleAdd = () => {
    const newBeneficiary: Beneficiary = {
      id: generateId(),
      name: formData.name || "",
      phone: formData.phone,
      email: formData.email,
      address: formData.address,
      category: formData.category || "Other",
      location: formData.location || "",
      urgency: formData.urgency || "medium",
      familyMembers: formData.familyMembers || 1,
      monthlyIncome: formData.monthlyIncome,
      needs: needsInput,
      status: "active",
      notes: formData.notes,
    };
    setBeneficiaries([newBeneficiary, ...beneficiaries]);
    setShowForm(false);
    setFormData({});
    setNeedsInput([]);
    toast.success("Beneficiary added successfully!");
  };

  const handleEdit = () => {
    if (!selectedBeneficiary) return;
    setBeneficiaries(beneficiaries.map(b => b.id === selectedBeneficiary.id ? { ...b, ...formData, needs: needsInput } : b));
    setShowEdit(false);
    setFormData({});
    setNeedsInput([]);
    toast.success("Beneficiary updated successfully!");
  };

  const handleDelete = () => {
    if (!selectedBeneficiary) return;
    setBeneficiaries(beneficiaries.filter(b => b.id !== selectedBeneficiary.id));
    setShowDelete(false);
    setSelectedBeneficiary(null);
    toast.success("Beneficiary deleted successfully!");
  };

  const openView = (beneficiary: Beneficiary) => { setSelectedBeneficiary(beneficiary); setShowView(true); };
  const openEdit = (beneficiary: Beneficiary) => { setSelectedBeneficiary(beneficiary); setFormData(beneficiary); setNeedsInput(beneficiary.needs); setShowEdit(true); };
  const openDelete = (beneficiary: Beneficiary) => { setSelectedBeneficiary(beneficiary); setShowDelete(true); };

  const toggleNeed = (need: string) => {
    setNeedsInput(prev => prev.includes(need) ? prev.filter(n => n !== need) : [...prev, need]);
  };

  const needOptions = ["Food", "Education", "Medical", "Shelter", "Clothing", "Employment"];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Beneficiaries</h2><p className="text-muted-foreground">Manage people receiving aid</p></div>
        <Button size="sm" onClick={() => { setFormData({}); setNeedsInput([]); setShowForm(true); }}><Plus className="w-4 h-4 mr-2" />Add Beneficiary</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Beneficiaries" value={mockStats.beneficiaries} icon={Users} />
        <StatsCard title="Active" value="2,180" icon={CheckCircle} trend="up" change="+45" />
        <StatsCard title="Critical Need" value="125" icon={AlertCircle} />
        <StatsCard title="Helped This Month" value="320" icon={HandHeart} trend="up" change="+18%" />
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Input placeholder="Search beneficiaries..." className="flex-1" />
        <Select defaultValue="all"><SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem><SelectItem value="Widow">Widow</SelectItem><SelectItem value="Orphan">Orphan</SelectItem><SelectItem value="Elderly">Elderly</SelectItem></SelectContent></Select>
        <Select defaultValue="all"><SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Urgency" /></SelectTrigger><SelectContent><SelectItem value="all">All Levels</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem></SelectContent></Select>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {beneficiaries.map((beneficiary) => (
          <Card key={beneficiary.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openView(beneficiary)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Avatar><AvatarFallback>{beneficiary.name.charAt(0)}</AvatarFallback></Avatar>
                  <div><p className="font-medium">{beneficiary.name}</p><p className="text-xs text-muted-foreground">{beneficiary.category}</p></div>
                </div>
                <Badge className={getUrgencyColor(beneficiary.urgency)}>{beneficiary.urgency}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="w-4 h-4" />{beneficiary.location}</div>
                <div className="flex items-center gap-2 text-muted-foreground"><Users className="w-4 h-4" />{beneficiary.familyMembers} family members</div>
                <div className="flex flex-wrap gap-1">{beneficiary.needs.map((need) => (<Badge key={need} variant="secondary" className="text-xs">{need}</Badge>))}</div>
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Last helped: {beneficiary.lastHelped || "Never"}</span>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openView(beneficiary)}><Eye className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(beneficiary)}><Edit className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => openDelete(beneficiary)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add Beneficiary Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add New Beneficiary</DialogTitle><DialogDescription>Register a new beneficiary in the system</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Full Name</Label><Input placeholder="Beneficiary name" value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input placeholder="+91 XXXXX XXXXX" value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Email (Optional)</Label><Input type="email" placeholder="email@example.com" value={formData.email || ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Address</Label><Textarea placeholder="Full address" rows={2} value={formData.address || ""} onChange={(e) => setFormData({ ...formData, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Location/Area</Label><Input placeholder="City/Area" value={formData.location || ""} onChange={(e) => setFormData({ ...formData, location: e.target.value })} /></div>
              <div className="space-y-2"><Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Widow">Widow</SelectItem><SelectItem value="Orphan">Orphan</SelectItem><SelectItem value="Elderly">Elderly</SelectItem>
                    <SelectItem value="Disabled">Disabled</SelectItem><SelectItem value="Single Mother">Single Mother</SelectItem><SelectItem value="Poor Family">Poor Family</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Urgency Level</Label>
                <Select value={formData.urgency} onValueChange={(v: "low" | "medium" | "high" | "critical") => setFormData({ ...formData, urgency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Family Members</Label><Input type="number" placeholder="1" value={formData.familyMembers || ""} onChange={(e) => setFormData({ ...formData, familyMembers: parseInt(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Monthly Income (₹)</Label><Input type="number" placeholder="5000" value={formData.monthlyIncome || ""} onChange={(e) => setFormData({ ...formData, monthlyIncome: parseFloat(e.target.value) })} /></div>
            </div>
            <div className="space-y-2"><Label>Needs</Label>
              <div className="flex flex-wrap gap-2">{needOptions.map((need) => (<label key={need} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-md cursor-pointer border ${needsInput.includes(need) ? "bg-primary text-primary-foreground border-primary" : "bg-muted"}`}><input type="checkbox" className="sr-only" checked={needsInput.includes(need)} onChange={() => toggleNeed(need)} />{need}</label>))}</div>
            </div>
            <div className="space-y-2"><Label>Notes (Optional)</Label><Textarea placeholder="Additional notes..." rows={2} value={formData.notes || ""} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add Beneficiary</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Beneficiary Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Beneficiary Details</DialogTitle></DialogHeader>
          {selectedBeneficiary && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <Avatar className="w-14 h-14"><AvatarFallback className="text-xl">{selectedBeneficiary.name.charAt(0)}</AvatarFallback></Avatar>
                <div><p className="font-bold text-xl">{selectedBeneficiary.name}</p><p className="text-sm text-muted-foreground">{selectedBeneficiary.category}</p></div>
                <Badge className={`ml-auto ${getUrgencyColor(selectedBeneficiary.urgency)}`}>{selectedBeneficiary.urgency}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label className="text-muted-foreground">Phone</Label><p>{selectedBeneficiary.phone || "N/A"}</p></div>
                <div><Label className="text-muted-foreground">Email</Label><p>{selectedBeneficiary.email || "N/A"}</p></div>
                <div><Label className="text-muted-foreground">Location</Label><p>{selectedBeneficiary.location}</p></div>
                <div><Label className="text-muted-foreground">Family Members</Label><p>{selectedBeneficiary.familyMembers}</p></div>
                <div><Label className="text-muted-foreground">Monthly Income</Label><p>{selectedBeneficiary.monthlyIncome ? `₹${selectedBeneficiary.monthlyIncome.toLocaleString()}` : "N/A"}</p></div>
                <div><Label className="text-muted-foreground">Status</Label><p><Badge variant={selectedBeneficiary.status === "active" ? "default" : "secondary"}>{selectedBeneficiary.status}</Badge></p></div>
              </div>
              <div><Label className="text-muted-foreground">Address</Label><p className="text-sm">{selectedBeneficiary.address || "N/A"}</p></div>
              <div><Label className="text-muted-foreground">Needs</Label><div className="flex flex-wrap gap-1 mt-1">{selectedBeneficiary.needs.map((need) => (<Badge key={need} variant="secondary">{need}</Badge>))}</div></div>
              {selectedBeneficiary.notes && (<div><Label className="text-muted-foreground">Notes</Label><p className="text-sm">{selectedBeneficiary.notes}</p></div>)}
              <div><Label className="text-muted-foreground">Last Helped</Label><p className="text-sm">{selectedBeneficiary.lastHelped || "Never"}</p></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => toast.success("Distribution record created!")}><Truck className="w-4 h-4 mr-2" />Record Distribution</Button>
            <Button variant="outline" onClick={() => { setShowView(false); openEdit(selectedBeneficiary!); }}><Edit className="w-4 h-4 mr-2" />Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Beneficiary Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Beneficiary</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Full Name</Label><Input value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Widow">Widow</SelectItem><SelectItem value="Orphan">Orphan</SelectItem><SelectItem value="Elderly">Elderly</SelectItem><SelectItem value="Disabled">Disabled</SelectItem><SelectItem value="Single Mother">Single Mother</SelectItem><SelectItem value="Poor Family">Poor Family</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Urgency Level</Label>
                <Select value={formData.urgency} onValueChange={(v: "low" | "medium" | "high" | "critical") => setFormData({ ...formData, urgency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Family Members</Label><Input type="number" value={formData.familyMembers || ""} onChange={(e) => setFormData({ ...formData, familyMembers: parseInt(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Status</Label>
                <Select value={formData.status} onValueChange={(v: "active" | "inactive") => setFormData({ ...formData, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Needs</Label>
              <div className="flex flex-wrap gap-2">{needOptions.map((need) => (<label key={need} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-md cursor-pointer border ${needsInput.includes(need) ? "bg-primary text-primary-foreground border-primary" : "bg-muted"}`}><input type="checkbox" className="sr-only" checked={needsInput.includes(need)} onChange={() => toggleNeed(need)} />{need}</label>))}</div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea rows={2} value={formData.notes || ""} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Beneficiary</DialogTitle><DialogDescription>Are you sure you want to delete this beneficiary? This action cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== VOLUNTEERS MODULE ====================
function VolunteersModule() {
  const [volunteers, setVolunteers] = useState<Volunteer[]>(initialVolunteers);
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [formData, setFormData] = useState<Partial<Volunteer>>({});
  const [skillsInput, setSkillsInput] = useState<string[]>([]);

  const skillOptions = ["Distribution", "Driving", "Teaching", "Medical Aid", "First Aid", "Administration", "Event Management", "Counseling"];

  const handleAdd = () => {
    const newVolunteer: Volunteer = {
      id: generateId(),
      name: formData.name || "",
      email: formData.email || "",
      phone: formData.phone || "",
      skills: skillsInput,
      area: formData.area || "",
      status: "pending",
      tasksCompleted: 0,
      joinedDate: new Date().toISOString().split("T")[0],
      emergencyContact: formData.emergencyContact,
    };
    setVolunteers([newVolunteer, ...volunteers]);
    setShowForm(false);
    setFormData({});
    setSkillsInput([]);
    toast.success("Volunteer registered successfully!");
  };

  const handleEdit = () => {
    if (!selectedVolunteer) return;
    setVolunteers(volunteers.map(v => v.id === selectedVolunteer.id ? { ...v, ...formData, skills: skillsInput } : v));
    setShowEdit(false);
    setFormData({});
    setSkillsInput([]);
    toast.success("Volunteer updated successfully!");
  };

  const handleDelete = () => {
    if (!selectedVolunteer) return;
    setVolunteers(volunteers.filter(v => v.id !== selectedVolunteer.id));
    setShowDelete(false);
    setSelectedVolunteer(null);
    toast.success("Volunteer deleted successfully!");
  };

  const openView = (volunteer: Volunteer) => { setSelectedVolunteer(volunteer); setShowView(true); };
  const openEdit = (volunteer: Volunteer) => { setSelectedVolunteer(volunteer); setFormData(volunteer); setSkillsInput(volunteer.skills); setShowEdit(true); };
  const openDelete = (volunteer: Volunteer) => { setSelectedVolunteer(volunteer); setShowDelete(true); };

  const toggleSkill = (skill: string) => {
    setSkillsInput(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]);
  };

  const approveVolunteer = (volunteer: Volunteer) => {
    setVolunteers(volunteers.map(v => v.id === volunteer.id ? { ...v, status: "active" as const } : v));
    toast.success(`${volunteer.name} approved as volunteer!`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Volunteers</h2><p className="text-muted-foreground">Manage volunteer team</p></div>
        <Button size="sm" onClick={() => { setFormData({}); setSkillsInput([]); setShowForm(true); }}><Plus className="w-4 h-4 mr-2" />Add Volunteer</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Volunteers" value={mockStats.volunteers} icon={Users} />
        <StatsCard title="Active" value="128" icon={CheckCircle} />
        <StatsCard title="Pending Approval" value="8" icon={Clock} />
        <StatsCard title="Tasks This Month" value="234" icon={Target} trend="up" change="+15%" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {volunteers.map((volunteer) => (
          <Card key={volunteer.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openView(volunteer)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Avatar><AvatarFallback>{volunteer.name.charAt(0)}</AvatarFallback></Avatar>
                  <div><p className="font-medium">{volunteer.name}</p><p className="text-xs text-muted-foreground">{volunteer.area}</p></div>
                </div>
                <Badge variant={volunteer.status === "active" ? "default" : volunteer.status === "pending" ? "secondary" : "outline"}>{volunteer.status}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-4 h-4" />{volunteer.email}</div>
                <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-4 h-4" />{volunteer.phone}</div>
                <div className="flex flex-wrap gap-1">{volunteer.skills.map((skill) => (<Badge key={skill} variant="secondary" className="text-xs">{skill}</Badge>))}</div>
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between">
                <span className="text-sm"><strong>{volunteer.tasksCompleted}</strong> tasks completed</span>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openView(volunteer)}><Eye className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(volunteer)}><Edit className="w-4 h-4" /></Button>
                  {volunteer.status === "pending" && (<Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={() => approveVolunteer(volunteer)}><CheckCircle className="w-4 h-4" /></Button>)}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add Volunteer Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add New Volunteer</DialogTitle><DialogDescription>Register a new volunteer</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Full Name</Label><Input placeholder="Volunteer name" value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input placeholder="+91 XXXXX XXXXX" value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" placeholder="email@example.com" value={formData.email || ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Assigned Area</Label><Input placeholder="Area/location" value={formData.area || ""} onChange={(e) => setFormData({ ...formData, area: e.target.value })} /></div>
            <div className="space-y-2"><Label>Skills</Label>
              <div className="flex flex-wrap gap-2">{skillOptions.map((skill) => (<label key={skill} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-md cursor-pointer border ${skillsInput.includes(skill) ? "bg-primary text-primary-foreground border-primary" : "bg-muted"}`}><input type="checkbox" className="sr-only" checked={skillsInput.includes(skill)} onChange={() => toggleSkill(skill)} />{skill}</label>))}</div>
            </div>
            <div className="space-y-2"><Label>Emergency Contact</Label><Input placeholder="Contact number" value={formData.emergencyContact || ""} onChange={(e) => setFormData({ ...formData, emergencyContact: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add Volunteer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Volunteer Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Volunteer Details</DialogTitle></DialogHeader>
          {selectedVolunteer && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <Avatar className="w-14 h-14"><AvatarFallback className="text-xl">{selectedVolunteer.name.charAt(0)}</AvatarFallback></Avatar>
                <div><p className="font-bold text-xl">{selectedVolunteer.name}</p><p className="text-sm text-muted-foreground">{selectedVolunteer.area}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label className="text-muted-foreground">Email</Label><p>{selectedVolunteer.email}</p></div>
                <div><Label className="text-muted-foreground">Phone</Label><p>{selectedVolunteer.phone}</p></div>
                <div><Label className="text-muted-foreground">Status</Label><p><Badge variant={selectedVolunteer.status === "active" ? "default" : "secondary"}>{selectedVolunteer.status}</Badge></p></div>
                <div><Label className="text-muted-foreground">Tasks Completed</Label><p className="font-bold text-primary">{selectedVolunteer.tasksCompleted}</p></div>
                <div><Label className="text-muted-foreground">Joined Date</Label><p>{selectedVolunteer.joinedDate}</p></div>
                <div><Label className="text-muted-foreground">Emergency Contact</Label><p>{selectedVolunteer.emergencyContact || "N/A"}</p></div>
              </div>
              <div><Label className="text-muted-foreground">Skills</Label><div className="flex flex-wrap gap-1 mt-1">{selectedVolunteer.skills.map((skill) => (<Badge key={skill} variant="secondary">{skill}</Badge>))}</div></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => toast.success("Task assigned!")}><Plus className="w-4 h-4 mr-2" />Assign Task</Button>
            <Button variant="outline" onClick={() => { setShowView(false); openEdit(selectedVolunteer!); }}><Edit className="w-4 h-4 mr-2" />Edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Volunteer Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Volunteer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Full Name</Label><Input value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Assigned Area</Label><Input value={formData.area || ""} onChange={(e) => setFormData({ ...formData, area: e.target.value })} /></div>
            <div className="space-y-2"><Label>Status</Label>
              <Select value={formData.status} onValueChange={(v: "active" | "inactive" | "pending") => setFormData({ ...formData, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="pending">Pending</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Skills</Label>
              <div className="flex flex-wrap gap-2">{skillOptions.map((skill) => (<label key={skill} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-md cursor-pointer border ${skillsInput.includes(skill) ? "bg-primary text-primary-foreground border-primary" : "bg-muted"}`}><input type="checkbox" className="sr-only" checked={skillsInput.includes(skill)} onChange={() => toggleSkill(skill)} />{skill}</label>))}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Volunteer</DialogTitle><DialogDescription>Are you sure you want to delete this volunteer? This action cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== INVENTORY MODULE ====================
function InventoryModule() {
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [showForm, setShowForm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showAddStock, setShowAddStock] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState<Partial<InventoryItem>>({});
  const [stockToAdd, setStockToAdd] = useState(0);

  const getStockStatus = (item: InventoryItem) => {
    if (item.quantity === 0) return { label: "Out of Stock", variant: "destructive" as const };
    if (item.quantity < item.minStock) return { label: "Low Stock", variant: "secondary" as const };
    return { label: "In Stock", variant: "default" as const };
  };

  const handleAdd = () => {
    const newItem: InventoryItem = {
      id: generateId(),
      name: formData.name || "",
      category: formData.category || "Other",
      unit: formData.unit || "pieces",
      quantity: formData.quantity || 0,
      minStock: formData.minStock || 10,
      pricePerUnit: formData.pricePerUnit,
      status: formData.quantity === 0 ? "out_of_stock" : (formData.quantity || 0) < (formData.minStock || 10) ? "low_stock" : "in_stock",
    };
    setInventory([newItem, ...inventory]);
    setShowForm(false);
    setFormData({});
    toast.success("Inventory item added successfully!");
  };

  const handleEdit = () => {
    if (!selectedItem) return;
    const updatedItem = { ...selectedItem, ...formData };
    updatedItem.status = updatedItem.quantity === 0 ? "out_of_stock" : updatedItem.quantity < updatedItem.minStock ? "low_stock" : "in_stock";
    setInventory(inventory.map(i => i.id === selectedItem.id ? updatedItem : i));
    setShowEdit(false);
    setFormData({});
    toast.success("Inventory item updated successfully!");
  };

  const handleDelete = () => {
    if (!selectedItem) return;
    setInventory(inventory.filter(i => i.id !== selectedItem.id));
    setShowDelete(false);
    setSelectedItem(null);
    toast.success("Inventory item deleted successfully!");
  };

  const handleAddStock = () => {
    if (!selectedItem) return;
    const updatedItem = { ...selectedItem, quantity: selectedItem.quantity + stockToAdd };
    updatedItem.status = updatedItem.quantity === 0 ? "out_of_stock" : updatedItem.quantity < updatedItem.minStock ? "low_stock" : "in_stock";
    setInventory(inventory.map(i => i.id === selectedItem.id ? updatedItem : i));
    setShowAddStock(false);
    setStockToAdd(0);
    toast.success(`Added ${stockToAdd} ${selectedItem.unit} to ${selectedItem.name}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Inventory</h2><p className="text-muted-foreground">Track stock and supplies</p></div>
        <Button size="sm" onClick={() => { setFormData({}); setShowForm(true); }}><Plus className="w-4 h-4 mr-2" />Add Item</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Items" value={mockStats.inventoryItems.toLocaleString()} icon={Package} />
        <StatsCard title="In Stock" value="3,150" icon={PackageCheck} />
        <StatsCard title="Low Stock Alerts" value="3" icon={AlertCircle} />
        <StatsCard title="Out of Stock" value="1" icon={AlertCircle} />
      </div>

      {inventory.some(i => i.status !== "in_stock") && (
        <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20"><AlertCircle className="h-4 w-4 text-yellow-600" /><AlertTitle>Low Stock Alert</AlertTitle><AlertDescription>Some items are running low or out of stock. Please restock soon.</AlertDescription></Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <Input placeholder="Search inventory..." className="w-full sm:max-w-xs" />
            <Select defaultValue="all"><SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All Categories</SelectItem><SelectItem value="Food Kit">Food Kit</SelectItem><SelectItem value="Sanitary Pads">Sanitary Pads</SelectItem><SelectItem value="Education Material">Education Material</SelectItem></SelectContent></Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Min Stock</TableHead><TableHead>Status</TableHead><TableHead className="w-[80px]">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {inventory.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell><Badge variant="outline">{item.category}</Badge></TableCell>
                  <TableCell className="text-right">{item.quantity} {item.unit}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{item.minStock} {item.unit}</TableCell>
                  <TableCell><Badge variant={getStockStatus(item).variant}>{getStockStatus(item).label}</Badge></TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setSelectedItem(item); setStockToAdd(0); setShowAddStock(true); }}><Plus className="w-4 h-4 mr-2" />Add Stock</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setSelectedItem(item); setFormData(item); setShowEdit(true); }}><Edit className="w-4 h-4 mr-2" />Edit</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" onClick={() => { setSelectedItem(item); setShowDelete(true); }}><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Item Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Inventory Item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Item Name</Label><Input placeholder="Item name" value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Food Kit">Food Kit</SelectItem><SelectItem value="Sanitary Pads">Sanitary Pads</SelectItem>
                    <SelectItem value="Education Material">Education Material</SelectItem><SelectItem value="Clothing">Clothing</SelectItem>
                    <SelectItem value="Medical">Medical</SelectItem><SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Unit</Label>
                <Select value={formData.unit} onValueChange={(v) => setFormData({ ...formData, unit: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent><SelectItem value="pieces">Pieces</SelectItem><SelectItem value="packs">Packs</SelectItem><SelectItem value="kg">Kg</SelectItem><SelectItem value="liters">Liters</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Initial Quantity</Label><Input type="number" placeholder="0" value={formData.quantity || ""} onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Minimum Stock Alert</Label><Input type="number" placeholder="10" value={formData.minStock || ""} onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) })} /></div>
            </div>
            <div className="space-y-2"><Label>Price Per Unit (₹)</Label><Input type="number" placeholder="0" value={formData.pricePerUnit || ""} onChange={(e) => setFormData({ ...formData, pricePerUnit: parseFloat(e.target.value) })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Stock Dialog */}
      <Dialog open={showAddStock} onOpenChange={setShowAddStock}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Stock</DialogTitle><DialogDescription>Add stock to {selectedItem?.name}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg"><p className="text-sm text-muted-foreground">Current Stock</p><p className="text-2xl font-bold">{selectedItem?.quantity} {selectedItem?.unit}</p></div>
            <div className="space-y-2"><Label>Quantity to Add</Label><Input type="number" placeholder="0" value={stockToAdd || ""} onChange={(e) => setStockToAdd(parseInt(e.target.value) || 0)} /></div>
            <div className="p-4 bg-primary/10 rounded-lg"><p className="text-sm text-muted-foreground">New Stock</p><p className="text-2xl font-bold text-primary">{(selectedItem?.quantity || 0) + stockToAdd} {selectedItem?.unit}</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddStock(false)}>Cancel</Button>
            <Button onClick={handleAddStock} disabled={stockToAdd <= 0}>Add Stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Inventory Item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Item Name</Label><Input value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Food Kit">Food Kit</SelectItem><SelectItem value="Sanitary Pads">Sanitary Pads</SelectItem><SelectItem value="Education Material">Education Material</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Unit</Label><Input value={formData.unit || ""} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Quantity</Label><Input type="number" value={formData.quantity || ""} onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Min Stock Alert</Label><Input type="number" value={formData.minStock || ""} onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Inventory Item</DialogTitle><DialogDescription>Are you sure you want to delete this item? This action cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== DISTRIBUTIONS MODULE ====================
function DistributionsModule() {
  const [distributions, setDistributions] = useState<Distribution[]>(initialDistributions);
  const [showForm, setShowForm] = useState(false);
  const [showView, setShowView] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selectedDistribution, setSelectedDistribution] = useState<Distribution | null>(null);
  const [formData, setFormData] = useState<Partial<Distribution>>({});

  const handleAdd = () => {
    const newDistribution: Distribution = {
      id: generateId(),
      type: formData.type || "Food Kit",
      beneficiaries: formData.beneficiaries || 0,
      location: formData.location || "",
      date: formData.date || new Date().toISOString().split("T")[0],
      volunteer: formData.volunteer || "",
      status: "scheduled",
      items: formData.items || [],
      notes: formData.notes,
    };
    setDistributions([newDistribution, ...distributions]);
    setShowForm(false);
    setFormData({});
    toast.success("Distribution scheduled successfully!");
  };

  const handleDelete = () => {
    if (!selectedDistribution) return;
    setDistributions(distributions.filter(d => d.id !== selectedDistribution.id));
    setShowDelete(false);
    setSelectedDistribution(null);
    toast.success("Distribution deleted successfully!");
  };

  const markComplete = (distribution: Distribution) => {
    setDistributions(distributions.map(d => d.id === distribution.id ? { ...d, status: "completed" as const } : d));
    toast.success("Distribution marked as completed!");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Distributions</h2><p className="text-muted-foreground">Track aid distribution activities</p></div>
        <Button size="sm" onClick={() => { setFormData({}); setShowForm(true); }}><Plus className="w-4 h-4 mr-2" />New Distribution</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Completed" value="89" icon={CheckCircle} />
        <StatsCard title="In Progress" value="3" icon={Truck} />
        <StatsCard title="Scheduled" value="5" icon={Calendar} />
        <StatsCard title="Beneficiaries Reached" value="1,850" icon={Users} trend="up" change="+120" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {distributions.map((distribution) => (
          <Card key={distribution.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setSelectedDistribution(distribution); setShowView(true); }}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div><h3 className="font-medium">{distribution.type}</h3><p className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{distribution.location}</p></div>
                <Badge variant={distribution.status === "completed" ? "default" : distribution.status === "in_progress" ? "secondary" : "outline"}>{distribution.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                <div><p className="text-muted-foreground">Beneficiaries</p><p className="font-medium">{distribution.beneficiaries}</p></div>
                <div><p className="text-muted-foreground">Date</p><p className="font-medium">{distribution.date}</p></div>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">{distribution.items.map((item) => (<Badge key={item} variant="secondary" className="text-xs">{item}</Badge>))}</div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Volunteer: {distribution.volunteer}</span>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {distribution.status !== "completed" && (<Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={() => markComplete(distribution)}><CheckCircle className="w-4 h-4" /></Button>)}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toast.success("Photo upload feature")}><Camera className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => { setSelectedDistribution(distribution); setShowDelete(true); }}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* New Distribution Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Record Distribution</DialogTitle><DialogDescription>Log a new distribution activity</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Distribution Type</Label>
                <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Food Kit">Food Kit</SelectItem><SelectItem value="Sanitary Pads">Sanitary Pads</SelectItem>
                    <SelectItem value="Education Material">Education Material</SelectItem><SelectItem value="Clothing">Clothing</SelectItem>
                    <SelectItem value="Medical Aid">Medical Aid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Beneficiaries Count</Label><Input type="number" placeholder="Number" value={formData.beneficiaries || ""} onChange={(e) => setFormData({ ...formData, beneficiaries: parseInt(e.target.value) })} /></div>
            </div>
            <div className="space-y-2"><Label>Location</Label><Input placeholder="Distribution location" value={formData.location || ""} onChange={(e) => setFormData({ ...formData, location: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Date</Label><Input type="date" value={formData.date || ""} onChange={(e) => setFormData({ ...formData, date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Volunteer</Label>
                <Select value={formData.volunteer} onValueChange={(v) => setFormData({ ...formData, volunteer: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{initialVolunteers.filter(v => v.status === "active").map(v => (<SelectItem key={v.id} value={v.name}>{v.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Items Distributed</Label><Textarea placeholder="List items..." rows={2} value={formData.items?.join(", ") || ""} onChange={(e) => setFormData({ ...formData, items: e.target.value.split(",").map(s => s.trim()) })} /></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea placeholder="Any additional notes..." rows={2} value={formData.notes || ""} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Distribution Dialog */}
      <Dialog open={showView} onOpenChange={setShowView}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Distribution Details</DialogTitle></DialogHeader>
          {selectedDistribution && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div><p className="font-bold text-xl">{selectedDistribution.type}</p><p className="text-sm text-muted-foreground">{selectedDistribution.location}</p></div>
                <Badge variant={selectedDistribution.status === "completed" ? "default" : "secondary"}>{selectedDistribution.status}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><Label className="text-muted-foreground">Beneficiaries</Label><p className="font-bold text-primary text-xl">{selectedDistribution.beneficiaries}</p></div>
                <div><Label className="text-muted-foreground">Date</Label><p>{selectedDistribution.date}</p></div>
                <div><Label className="text-muted-foreground">Volunteer</Label><p>{selectedDistribution.volunteer}</p></div>
              </div>
              <div><Label className="text-muted-foreground">Items Distributed</Label><div className="flex flex-wrap gap-1 mt-1">{selectedDistribution.items.map((item) => (<Badge key={item} variant="secondary">{item}</Badge>))}</div></div>
              {selectedDistribution.notes && (<div><Label className="text-muted-foreground">Notes</Label><p className="text-sm">{selectedDistribution.notes}</p></div>)}
            </div>
          )}
          <DialogFooter>
            {selectedDistribution?.status !== "completed" && (<Button onClick={() => { markComplete(selectedDistribution!); setShowView(false); }}><CheckCircle className="w-4 h-4 mr-2" />Mark Complete</Button>)}
            <Button variant="outline" onClick={() => toast.success("Report generated!")}><Download className="w-4 h-4 mr-2" />Report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Distribution</DialogTitle><DialogDescription>Are you sure you want to delete this distribution record?</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== SANITARY PADS MODULE ====================
function SanitaryPadsModule() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Sanitary Pads Initiative</h2><p className="text-muted-foreground">Track pad distribution and awareness programs</p></div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4 mr-2" />Record Distribution</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Schools Covered" value="25" icon={Target} />
        <StatsCard title="Girls Supported" value="3,500" icon={Users} trend="up" change="+450" />
        <StatsCard title="Pads Distributed" value="15,000" icon={Sparkles} />
        <StatsCard title="Awareness Sessions" value="45" icon={FileText} trend="up" change="+8" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Monthly Progress</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={padDistributionData}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                <Bar dataKey="girls" fill="oklch(0.55 0.15 145)" name="Girls Reached" /><Bar dataKey="sessions" fill="oklch(0.65 0.12 145)" name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Schools Coverage</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={padDistributionData}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip />
                <Line type="monotone" dataKey="schools" stroke="oklch(0.55 0.15 145)" strokeWidth={2} dot={{ fill: "oklch(0.55 0.15 145)" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent Distributions</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Location/School</TableHead><TableHead>Girls</TableHead><TableHead>Pads</TableHead><TableHead>Session</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell>Govt School, Mysore</TableCell><TableCell>120</TableCell><TableCell>480</TableCell><TableCell><CheckCircle className="w-4 h-4 text-green-600" /></TableCell><TableCell>2024-01-14</TableCell></TableRow>
              <TableRow><TableCell>Girls High School, Tumkur</TableCell><TableCell>85</TableCell><TableCell>340</TableCell><TableCell><CheckCircle className="w-4 h-4 text-green-600" /></TableCell><TableCell>2024-01-12</TableCell></TableRow>
              <TableRow><TableCell>Rural School, Hubli</TableCell><TableCell>95</TableCell><TableCell>380</TableCell><TableCell><CheckCircle className="w-4 h-4 text-green-600" /></TableCell><TableCell>2024-01-10</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Pad Distribution</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>School/Location</Label><Input placeholder="School or area name" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Number of Girls</Label><Input type="number" placeholder="Count" /></div>
              <div className="space-y-2"><Label>Pads Distributed</Label><Input type="number" placeholder="Count" /></div>
            </div>
            <div className="space-y-2"><Label className="flex items-center gap-2"><input type="checkbox" className="rounded" />Awareness Session Conducted</Label></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea placeholder="Additional notes..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={() => { setShowForm(false); toast.success("Distribution recorded!"); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== REPORTS MODULE ====================
function ReportsModule() {
  const [reportType, setReportType] = useState("donations");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div><h2 className="text-2xl font-bold">Reports & Analytics</h2><p className="text-muted-foreground">Generate and export reports</p></div>
      </div>

      <Tabs value={reportType} onValueChange={setReportType}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="donations">Donations</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="beneficiaries">Beneficiaries</TabsTrigger>
          <TabsTrigger value="impact">Impact</TabsTrigger>
        </TabsList>

        <TabsContent value="donations" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>Donation Report</CardTitle><CardDescription>Comprehensive donation analytics</CardDescription></div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => toast.success("CSV exported!")}><Download className="w-4 h-4 mr-2" />CSV</Button>
                  <Button variant="outline" size="sm" onClick={() => toast.success("PDF exported!")}><FileText className="w-4 h-4 mr-2" />PDF</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-lg bg-muted"><p className="text-sm text-muted-foreground">Total Donations</p><p className="text-2xl font-bold">₹12,50,000</p></div>
                <div className="p-4 rounded-lg bg-muted"><p className="text-sm text-muted-foreground">Average Donation</p><p className="text-2xl font-bold">₹3,500</p></div>
                <div className="p-4 rounded-lg bg-muted"><p className="text-sm text-muted-foreground">Total Donors</p><p className="text-2xl font-bold">1,245</p></div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={donationTrendData}>
                  <defs><linearGradient id="colorAmount2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="oklch(0.55 0.15 145)" stopOpacity={0.3}/><stop offset="95%" stopColor="oklch(0.55 0.15 145)" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip />
                  <Area type="monotone" dataKey="amount" stroke="oklch(0.55 0.15 145)" fill="url(#colorAmount2)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Campaign Performance</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Target</TableHead><TableHead>Raised</TableHead><TableHead>Progress</TableHead><TableHead>Donors</TableHead></TableRow></TableHeader>
                <TableBody>
                  {initialCampaigns.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">{campaign.title}</TableCell>
                      <TableCell>₹{campaign.targetAmount.toLocaleString()}</TableCell>
                      <TableCell className="text-primary font-bold">₹{campaign.raisedAmount.toLocaleString()}</TableCell>
                      <TableCell><div className="flex items-center gap-2"><Progress value={(campaign.raisedAmount / campaign.targetAmount) * 100} className="w-20 h-2" /><span className="text-xs">{Math.round((campaign.raisedAmount / campaign.targetAmount) * 100)}%</span></div></TableCell>
                      <TableCell>{campaign.donors}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="beneficiaries" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Beneficiary Distribution</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-4">By Category</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={[{ name: "Widow", value: 35 }, { name: "Orphan", value: 20 }, { name: "Elderly", value: 15 }, { name: "Disabled", value: 10 }, { name: "Others", value: 20 }]} cx="50%" cy="50%" outerRadius={80} dataKey="value" label>
                        {[0, 1, 2, 3, 4].map((i) => (<Cell key={i} fill={`oklch(${0.55 + i * 0.05} 0.15 145)`} />))}
                      </Pie><Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <h4 className="font-medium mb-4">By Urgency</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between"><span className="text-sm">Critical</span><Badge variant="destructive">125</Badge></div>
                    <div className="flex items-center justify-between"><span className="text-sm">High</span><Badge className="bg-orange-100 text-orange-700">340</Badge></div>
                    <div className="flex items-center justify-between"><span className="text-sm">Medium</span><Badge className="bg-yellow-100 text-yellow-700">890</Badge></div>
                    <div className="flex items-center justify-between"><span className="text-sm">Low</span><Badge className="bg-green-100 text-green-700">1095</Badge></div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="impact" className="space-y-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><div className="text-center"><p className="text-4xl font-bold text-primary">2,450</p><p className="text-sm text-muted-foreground">Families Helped</p></div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-center"><p className="text-4xl font-bold text-primary">15,000</p><p className="text-sm text-muted-foreground">Meals Served</p></div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-center"><p className="text-4xl font-bold text-primary">500+</p><p className="text-sm text-muted-foreground">Students Supported</p></div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-center"><p className="text-4xl font-bold text-primary">3,500</p><p className="text-sm text-muted-foreground">Girls Reached</p></div></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Impact Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div><h5 className="font-bold">Food Security</h5><p className="text-sm text-muted-foreground">Distributed food kits to 1,800 families, ensuring nutritional support during difficult times.</p></div>
                <div><h5 className="font-bold">Education</h5><p className="text-sm text-muted-foreground">Supported 500+ students with educational materials and scholarships.</p></div>
                <div><h5 className="font-bold">Women's Health</h5><p className="text-sm text-muted-foreground">Reached 3,500 girls through sanitary pad distribution and awareness programs.</p></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ==================== SETTINGS MODULE ====================
function SettingsModule() {
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState("en");

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold">Settings</h2><p className="text-muted-foreground">Manage your account and preferences</p></div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>Update your personal information</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16"><AvatarFallback className="text-lg">{mockUser.name.charAt(0)}</AvatarFallback></Avatar>
              <Button variant="outline" size="sm">Change Avatar</Button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Full Name</Label><Input defaultValue={mockUser.name} /></div>
              <div className="space-y-2"><Label>Email</Label><Input defaultValue={mockUser.email} type="email" /></div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Phone</Label><Input defaultValue={mockUser.phone} /></div>
              <div className="space-y-2"><Label>Role</Label><Input defaultValue={mockUser.role} disabled className="capitalize" /></div>
            </div>
            <Button onClick={() => toast.success("Profile updated!")}>Save Changes</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Preferences</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div><Label>Dark Mode</Label><p className="text-xs text-muted-foreground">Toggle dark theme</p></div>
              <Switch checked={darkMode} onCheckedChange={setDarkMode} />
            </div>
            <Separator />
            <div className="space-y-2"><Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="hi">हिंदी (Hindi)</SelectItem><SelectItem value="kn">ಕನ್ನಡ (Kannada)</SelectItem></SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between"><div><Label>Notifications</Label><p className="text-xs text-muted-foreground">Email notifications</p></div><Switch defaultChecked /></div>
            <div className="flex items-center justify-between"><div><Label>SMS Alerts</Label><p className="text-xs text-muted-foreground">SMS notifications</p></div><Switch defaultChecked /></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Organization Settings</CardTitle><CardDescription>Configure trust details</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Organization Name</Label><Input defaultValue="United Angel Reach Trust" /></div>
            <div className="space-y-2"><Label>Registration Number</Label><Input defaultValue="TR/1234/2020" /></div>
          </div>
          <div className="space-y-2"><Label>Address</Label><Textarea defaultValue="123 Charity Lane, Bangalore - 560001, Karnataka, India" rows={2} /></div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Contact Email</Label><Input defaultValue="contact@unitedangelreach.org" /></div>
            <div className="space-y-2"><Label>Contact Phone</Label><Input defaultValue="+91 80 1234 5678" /></div>
            <div className="space-y-2"><Label>UPI ID</Label><Input defaultValue="unitedangelreach@upi" /></div>
          </div>
          <Button onClick={() => toast.success("Organization settings saved!")}>Save Organization Settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== MAIN APP ====================
export default function UnitedAngelReachApp() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // Sync dark mode class with state
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [isDark]);

  const toggleTheme = () => setIsDark(!isDark);

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard": return <Dashboard setActiveTab={setActiveTab} />;
      case "donations": return <DonationsModule />;
      case "campaigns": return <CampaignsModule />;
      case "beneficiaries": return <BeneficiariesModule />;
      case "volunteers": return <VolunteersModule />;
      case "inventory": return <InventoryModule />;
      case "distributions": return <DistributionsModule />;
      case "sanitary-pads": return <SanitaryPadsModule />;
      case "reports": return <ReportsModule />;
      case "settings": return <SettingsModule />;
      default: return <Dashboard setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-row">
      <SidebarNav activeTab={activeTab} setActiveTab={setActiveTab} isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
          <div className="flex items-center justify-between h-14 px-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}><Menu className="w-5 h-5" /></Button>
              <div className="hidden sm:flex items-center gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search..." className="w-64 pl-9" /></div></div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme}>{isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</Button>
              <Button variant="ghost" size="icon" className="relative"><Bell className="w-5 h-5" /><span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" /></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><Globe className="w-5 h-5" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuItem>English</DropdownMenuItem><DropdownMenuItem>हिंदी (Hindi)</DropdownMenuItem><DropdownMenuItem>ಕನ್ನಡ (Kannada)</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.2 }}>
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="border-t py-4 px-6 bg-muted/30">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
            <p>© 2024 United Angel Reach Trust. All rights reserved.</p>
            <div className="flex items-center gap-4"><a href="#" className="hover:text-primary">Privacy Policy</a><a href="#" className="hover:text-primary">Terms of Service</a><a href="#" className="hover:text-primary">Contact</a></div>
          </div>
        </footer>
      </div>
    </div>
  );
}
