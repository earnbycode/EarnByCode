import { CodeExecutionResult } from '../types/codeExecution';

// Import types
import { User } from '../types';

export interface TestCase {
  input: string;
  output: string;
  expectedOutput: string;
  isHidden: boolean;
}

export interface Problem {
  _id: string;
  title: string;
  description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  points: number;
  testCases: TestCase[];
  starterCode: Record<string, string>;
  isPremium: boolean;
  isPublished?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Contest {
  _id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  duration: number;
  entryFee: number;
  prizePool: number;
  maxParticipants: number;
  problems: string[];
  participants: string[];
  isPublic: boolean;
  status?: 'upcoming' | 'ongoing' | 'completed'; // Added status field
  createdAt: string;
  updatedAt: string;
}

// Resolve API base URL with sensible defaults:
// 1) If VITE_API_URL is set, use it.
// 2) Else, default to local dev server (also for prod in this local-only setup).
const DEFAULT_PROD_API = 'http://localhost:5000/api';
const DEFAULT_DEV_API = 'http://localhost:5000/api';
const API_BASE_URL = (import.meta.env.VITE_API_URL?.toString().trim()) || (import.meta.env.PROD ? DEFAULT_PROD_API : DEFAULT_DEV_API);

// Transient error detection (network resets, timeouts, 5xx)
const isTransientError = (error: unknown, response?: Response) => {
  if (response) {
    return response.status >= 500 && response.status < 600; // 5xx
  }
  const msg = String((error as any)?.message || error || '').toLowerCase();
  return (
    msg.includes('networkerror') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('wsarecv') ||
    msg.includes('forcibly closed') ||
    msg.includes('aborted')
  );
};

class ApiService {
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    data?: unknown,
    options?: { timeoutMs?: number; retries?: number; retryDelayMs?: number }
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    // Retry + timeout wrapper
    const timeoutMs = options?.timeoutMs ?? 12000;
    const maxRetries = options?.retries ?? 2;
    const retryDelayMs = options?.retryDelayMs ?? 600;

    let attempt = 0;
    let lastError: unknown;
    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...config, signal: controller.signal });
        const responseData = await response.json().catch(() => ({}));

        if (!response.ok) {
          // Retry only transient server errors
          if (isTransientError(null, response) && attempt < maxRetries) {
            attempt++;
            await new Promise(r => setTimeout(r, retryDelayMs * attempt));
            continue;
          }
          throw new Error(responseData.message || `Request failed (${response.status})`);
        }

        return responseData as T;
      } catch (error) {
        lastError = error;
        // Retry on network/transient errors
        if (isTransientError(error) && attempt < maxRetries) {
          attempt++;
          await new Promise(r => setTimeout(r, retryDelayMs * attempt));
          continue;
        }
        console.error(`API Request Error [${method} ${endpoint}] (attempt ${attempt + 1}/${maxRetries + 1}):`, error);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    // Should not reach here
    throw lastError ?? new Error('Request failed');
  }

  // Admin methods
  async blockUser(userId: string, data: { reason: string; duration: number; durationUnit: string }): Promise<{ success: boolean; blockedUntil: string; blockReason: string; user: User }> {
    return this.request('POST', `/admin/users/${userId}/block`, data);
  }

  async unblockUser(userId: string): Promise<{ success: boolean }> {
    return this.request('POST', `/admin/users/${userId}/unblock`);
  }

  // HTTP methods
  async post<T>(endpoint: string, data?: unknown, options?: { timeoutMs?: number; retries?: number; retryDelayMs?: number }): Promise<T> {
    return this.request<T>('POST', endpoint, data, options);
  }

  // Auth methods
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    return this.request('POST', '/auth/login', { email, password });
  }

  async register(username: string, email: string, password: string, fullName?: string): Promise<any> {
    // Longer timeout and no retries to avoid AbortError loops during email send
    return this.request<any>('POST', '/auth/register', { username, email, password, fullName }, { timeoutMs: 20000, retries: 0 });
  }

  async getCurrentUser(): Promise<User> {
    return this.request('GET', '/auth/me');
  }

  // Forgot password OTP flow removed. Implement tokenized reset when ready.

  // Problem methods
  async getProblems(filters: { difficulty?: string; status?: string } = {}): Promise<Problem[]> {
    const query = new URLSearchParams(filters as Record<string, string>).toString();
    return this.request('GET', `/problems?${query}`);
  }

  async getProblem(problemId: string): Promise<Problem> {
    return this.request('GET', `/problems/${problemId}`);
  }

  async createProblem(problemData: Omit<Problem, '_id' | 'createdAt' | 'updatedAt'>): Promise<Problem> {
    return this.request('POST', '/admin/problems', problemData);
  }

  async updateProblem(problemId: string, problemData: Partial<Problem>): Promise<Problem> {
    return this.request('PUT', `/admin/problems/${problemId}`, problemData);
  }

  async deleteProblem(problemId: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/admin/problems/${problemId}`);
  }

  // Code execution methods
  async runCode(problemId: string, code: string, language: string): Promise<CodeExecutionResult> {
    return this.request('POST', `/problems/${problemId}/run`, { code, language });
  }

  async submitCode(problemId: string, code: string, language: string): Promise<CodeExecutionResult> {
    return this.request('POST', `/problems/${problemId}/submit`, { code, language });
  }

  // Contest methods
  // Get contests for admin (requires authentication)
  async getContests(): Promise<Contest[]> {
    const contests = await this.request<Contest[]>('GET', '/admin/contests');
    return this.addStatusToContests(contests);
  }

  // Get public contests for all users
  async getPublicContests(): Promise<Contest[]> {
    try {
      console.log(`Fetching contests from: ${API_BASE_URL}/contests`);
      const response = await fetch(`${API_BASE_URL}/contests`);
      console.log('Contests API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response from contests API:', errorText);
        throw new Error(`Failed to fetch public contests: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Raw contests data:', data);
      
      // Extract the contests array from the response
      const contests = Array.isArray(data) ? data : data.contests || [];
      
      if (!Array.isArray(contests)) {
        console.error('Expected an array of contests but got:', data);
        return [];
      }
      
      const processedContests = this.addStatusToContests(contests);
      console.log('Processed contests with statuses:', processedContests);
      return processedContests;
    } catch (error) {
      console.error('Error in getPublicContests:', error);
      throw error;
    }
  }

  // Helper method to add status to contests
  private addStatusToContests(contests: Contest[]): Contest[] {
    const now = new Date();
    return contests.map(contest => {
      const startTime = new Date(contest.startTime);
      const endTime = new Date(contest.endTime);
      
      if (now < startTime) {
        contest.status = 'upcoming';
      } else if (now >= startTime && now <= endTime) {
        contest.status = 'ongoing';
      } else {
        contest.status = 'completed';
      }
      
      return contest;
    });
  }

  async getContest(contestId: string): Promise<Contest> {
    return this.request('GET', `/admin/contests/${contestId}`);
  }

  async createContest(contestData: Omit<Contest, '_id' | 'createdAt' | 'updatedAt'>): Promise<Contest> {
    return this.request('POST', '/admin/contests', contestData);
  }

  async updateContest(contestId: string, contestData: Partial<Contest>): Promise<Contest> {
    return this.request('PUT', `/admin/contests/${contestId}`, contestData);
  }

  async deleteContest(contestId: string): Promise<void> {
    return this.request('DELETE', `/admin/contests/${contestId}`);
  }

  // Payment methods
  async createPaymentIntent(amount: number): Promise<{ clientSecret: string }> {
    return this.request('POST', '/payments/create-payment-intent', { amount });
  }

  async withdraw(amount: number): Promise<{ success: boolean; message: string }> {
    return this.request('POST', '/payments/withdraw', { amount });
  }

  // Leaderboard methods
  async getUsersLeaderboard(params: {
    sortBy?: string;
    limit?: number;
    include?: string;
  } = {}): Promise<{ data: Array<{
    _id: string;
    username: string;
    fullName?: string;
    points: number;
    codecoins: number;
    solvedProblems: string[];
    totalSolved: number;
  }> }> {
    const query = new URLSearchParams();
    if (params.sortBy) query.append('sortBy', params.sortBy);
    if (params.limit) query.append('limit', params.limit.toString());
    if (params.include) query.append('include', params.include);
    
    return this.request('GET', `/users/leaderboard?${query.toString()}`);
  }

  async getTransactions(): Promise<any[]> {
    return this.request('GET', '/payments/transactions');
  }

  async confirmPayment(paymentIntentId: string): Promise<{ success: boolean }> {
    return this.request('POST', '/payments/confirm', { paymentIntentId });
  }

  // Admin methods
  async getAdminStats(): Promise<{
    stats: {
      totalUsers: number;
      activeUsers: number;
      blockedUsers: number;
      totalProblems: number;
      totalContests: number;
      activeContests?: number;
      totalSubmissions: number;
    };
    message?: string;
  }> {
    return this.request('GET', '/admin/stats');
  }

  // Admin wallet metrics
  async getAdminWalletMetrics(): Promise<{ success: boolean; metrics: { totalCollected: number; totalPayouts: number; adminBalance: number; } }> {
    return this.request('GET', '/wallet/admin/metrics');
  }

  // Admin all transactions
  async getAdminAllTransactions(params: { page?: number; limit?: number; type?: string; status?: string; userId?: string } = {}): Promise<{
    success: boolean;
    transactions: any[];
    pagination: { total: number; page: number; pages: number; limit: number };
  }> {
    const query = new URLSearchParams();
    if (params.page) query.append('page', String(params.page));
    if (params.limit) query.append('limit', String(params.limit));
    if (params.type) query.append('type', params.type);
    if (params.status) query.append('status', params.status);
    if (params.userId) query.append('userId', params.userId);
    return this.request('GET', `/wallet/admin/transactions?${query.toString()}`);
  }

  // Admin withdraw
  async adminWithdraw(amount: number): Promise<{ success: boolean; balance: number; transactionId: string }> {
    return this.request('POST', '/wallet/admin/withdraw', { amount });
  }

  // Settle a contest (admin)
  async settleContest(contestId: string): Promise<{ message: string; totals: { totalCollected: number; totalPrizes: number; remainder: number } }> {
    return this.request('POST', `/contests/${contestId}/settle`);
  }

  async getAdminUsers(params: { page?: number; limit?: number; search?: string } = {}): Promise<{
    users: User[];
    total: number;
    page: number;
    limit: number;
  }> {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page.toString());
    if (params.limit) query.append('limit', params.limit.toString());
    if (params.search) query.append('search', params.search);
    
    return this.request('GET', `/admin/users?${query.toString()}`);
  }

  async getUsers(params: { page?: number; limit?: number; search?: string } = {}): Promise<{
    users: User[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.getAdminUsers(params);
  }

  // Admin Problems methods
  async getAdminProblems(params: { 
    page?: number; 
    limit?: number; 
    search?: string;
    difficulty?: string;
    status?: string;
  } = {}): Promise<{ problems: Problem[]; total: number }> {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page.toString());
    if (params.limit) query.append('limit', params.limit.toString());
    if (params.search) query.append('search', params.search);
    if (params.difficulty) query.append('difficulty', params.difficulty);
    if (params.status) query.append('status', params.status);
    
    return this.request('GET', `/admin/problems?${query.toString()}`);
  }

  // Admin Contests methods
  async getAdminContests(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: 'upcoming' | 'ongoing' | 'completed';
  } = {}): Promise<{ contests: Contest[]; total: number }> {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page.toString());
    if (params.limit) query.append('limit', params.limit.toString());
    if (params.search) query.append('search', params.search);
    if (params.status) query.append('status', params.status);
    
    return this.request('GET', `/admin/contests?${query.toString()}`);
  }

  // Submission methods
  async getSubmissions(): Promise<any[]> {
    return this.request('GET', '/submissions');
  }

  // Generic GET request method
  async get<T>(url: string, params?: Record<string, any>): Promise<T> {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    return this.request('GET', `${url}${query}`);
  }

  async joinContest(contestId: string): Promise<{ success: boolean; message?: string }> {
    return this.request('POST', `/contests/${contestId}/join`);
  }
}

const apiService = new ApiService();

// Export types
export type { Contest };
export type { Contest as IContest };

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  difficulty?: string;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
  totalProblems: number;
  totalContests: number;
  totalSubmissions: number;
}

export interface AdminProblem extends Problem {
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  author: string;
}

export interface AdminContest extends Contest {
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export default apiService;

// Helper function to handle API errors
export function handleApiError(error: unknown): string {
  if (error instanceof Error) {
    console.error('API Error:', error.message);
    return error.message;
  }
  return 'An unknown error occurred';
}

// Type guards for API responses
export function isApiError(response: unknown): response is { message: string } {
  return typeof response === 'object' && response !== null && 'message' in response;
}

export function isPaginatedResponse<T>(response: unknown): response is { data: T[]; total: number } {
  return (
    typeof response === 'object' && 
    response !== null && 
    'data' in response && 
    'total' in response
  );
}