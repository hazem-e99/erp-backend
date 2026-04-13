/**
 * ERP System — Full QA Test Runner v2
 * Starts an in-memory MongoDB, boots the NestJS server, and runs all API tests.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const http = require('http');

const BASE = 'http://localhost:3001/api';
let mongod;
let serverProcess;

// Test state
const state = {};
const results = { passed: [], failed: [], bugs: [] };

// ═══════════════════════════════════════════
// HTTP helper
// ═══════════════════════════════════════════
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Test helpers
let totalTests = 0;
async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    results.passed.push(name);
    console.log(`  ✅ ${name}`);
  } catch (e) {
    results.failed.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertStatus(res, expected, ctx = '') {
  if (res.status !== expected)
    throw new Error(`Expected ${expected}, got ${res.status}${ctx ? ': '+ctx : ''} — ${JSON.stringify(res.data).substring(0,250)}`);
}

async function waitForServer(max = 30) {
  for (let i = 0; i < max; i++) {
    try { await request('GET', '/auth/profile'); return; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  throw new Error('Server timeout');
}

// ═══════════════════════════════════════════
// 1. AUTH
// ═══════════════════════════════════════════
async function testAuth() {
  console.log('\n🔐 AUTH MODULE');

  await test('Register first user (should become Super Admin)', async () => {
    const res = await request('POST', '/auth/register', {
      name: 'Admin User', email: 'admin@test.com', password: 'password123',
    });
    assertStatus(res, 201);
    assert(res.data.token, 'Missing token');
    assert(res.data.user, 'Missing user');
    assert(!res.data.user.password, 'Password leaked');
    state.adminToken = res.data.token;
    state.adminUser = res.data.user;
    // Verify Super Admin role was assigned
    const roleName = res.data.user.role?.name;
    assert(roleName === 'Super Admin', `First user should be Super Admin, got: ${roleName}`);
  });

  await test('Register duplicate email → 409', async () => {
    const res = await request('POST', '/auth/register', {
      name: 'Dup', email: 'admin@test.com', password: 'password123',
    });
    assertStatus(res, 409);
  });

  await test('Register invalid email → 400', async () => {
    const res = await request('POST', '/auth/register', {
      name: 'Bad', email: 'not-email', password: 'password123',
    });
    assertStatus(res, 400);
  });

  await test('Register short password → 400', async () => {
    const res = await request('POST', '/auth/register', {
      name: 'Short', email: 'short@test.com', password: '12',
    });
    assertStatus(res, 400);
  });

  await test('Login correct credentials', async () => {
    const res = await request('POST', '/auth/login', {
      email: 'admin@test.com', password: 'password123',
    });
    assertStatus(res, 201);
    assert(res.data.token, 'Missing token');
    state.adminToken = res.data.token; // refresh token
  });

  await test('Login wrong password → 401', async () => {
    const res = await request('POST', '/auth/login', {
      email: 'admin@test.com', password: 'wrongpass',
    });
    assertStatus(res, 401);
  });

  await test('Login non-existent email → 401', async () => {
    const res = await request('POST', '/auth/login', {
      email: 'ghost@test.com', password: 'password123',
    });
    assertStatus(res, 401);
  });

  await test('Profile with valid token → 200', async () => {
    const res = await request('GET', '/auth/profile', null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.email === 'admin@test.com', 'Wrong email');
  });

  await test('Profile without token → 401', async () => {
    const res = await request('GET', '/auth/profile');
    assertStatus(res, 401);
  });

  await test('Profile with fake token → 401', async () => {
    const res = await request('GET', '/auth/profile', null, 'fake.jwt.token');
    assertStatus(res, 401);
  });

  await test('Register second user (Employee role)', async () => {
    const res = await request('POST', '/auth/register', {
      name: 'Emp User', email: 'emp@test.com', password: 'password123',
    });
    assertStatus(res, 201);
    state.empToken = res.data.token;
    state.empUser = res.data.user;
    const roleName = res.data.user.role?.name;
    assert(roleName === 'Employee', `Second user should be Employee, got: ${roleName}`);
  });
}

// ═══════════════════════════════════════════
// 2. RBAC
// ═══════════════════════════════════════════
async function testRBAC() {
  console.log('\n🔒 RBAC MODULE');

  await test('List roles (Super Admin)', async () => {
    const res = await request('GET', '/roles', null, state.adminToken);
    assertStatus(res, 200);
    const roles = Array.isArray(res.data) ? res.data : res.data.data;
    assert(roles.length >= 3, 'Should have 3+ seeded roles');
    state.superAdminRole = roles.find(r => r.name === 'Super Admin');
    state.employeeRole = roles.find(r => r.name === 'Employee');
    state.managerRole = roles.find(r => r.name === 'Manager');
    assert(state.superAdminRole, 'Missing Super Admin role');
  });

  await test('List roles (Employee) → 403', async () => {
    const res = await request('GET', '/roles', null, state.empToken);
    assertStatus(res, 403);
  });

  await test('Create custom role', async () => {
    const res = await request('POST', '/roles', {
      name: 'QA Tester', description: 'Test role',
      permissions: ['projects:read', 'tasks:read'],
    }, state.adminToken);
    assertStatus(res, 201);
    state.qaRole = res.data;
  });

  await test('Assign role to user', async () => {
    const res = await request('POST', '/roles/assign', {
      userId: state.empUser._id, roleId: state.managerRole._id,
    }, state.adminToken);
    assertStatus(res, 201);
    // Re-login to get updated permissions
    const loginRes = await request('POST', '/auth/login', {
      email: 'emp@test.com', password: 'password123',
    });
    state.empToken = loginRes.data.token;
  });

  await test('Super Admin wildcard permission', async () => {
    assert(state.superAdminRole.permissions.includes('*'), 'Should have *');
  });

  await test('Delete non-system role', async () => {
    if (!state.qaRole) return;
    const res = await request('DELETE', `/roles/${state.qaRole._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Delete system role → fail', async () => {
    const res = await request('DELETE', `/roles/${state.superAdminRole._id}`, null, state.adminToken);
    assertStatus(res, 409);
  });

  await test('Unauthorized route without token → 401', async () => {
    const res = await request('GET', '/users');
    assertStatus(res, 401);
  });
}

// ═══════════════════════════════════════════
// 3. USERS
// ═══════════════════════════════════════════
async function testUsers() {
  console.log('\n👤 USERS MODULE');

  await test('Get all users', async () => {
    const res = await request('GET', '/users', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get user by ID', async () => {
    const res = await request('GET', `/users/${state.adminUser._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Invalid ObjectId → 400', async () => {
    const res = await request('GET', '/users/not-valid-id', null, state.adminToken);
    assertStatus(res, 400);
  });

  await test('Update user', async () => {
    const res = await request('PUT', `/users/${state.adminUser._id}`, {
      name: 'Updated Admin', phone: '+123',
    }, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Non-existent user → 404', async () => {
    const res = await request('GET', '/users/507f1f77bcf86cd799439011', null, state.adminToken);
    assertStatus(res, 404);
  });
}

// ═══════════════════════════════════════════
// 4. EMPLOYEES
// ═══════════════════════════════════════════
async function testEmployees() {
  console.log('\n👨‍💼 EMPLOYEES MODULE');

  await test('Create employee for admin', async () => {
    const res = await request('POST', '/employees', {
      userId: state.adminUser._id, employeeId: 'EMP001',
      department: 'Management', position: 'CEO',
      baseSalary: 15000, dateOfJoining: '2024-01-01',
    }, state.adminToken);
    assertStatus(res, 201);
    state.adminEmp = res.data;
  });

  await test('Create employee for emp user', async () => {
    const res = await request('POST', '/employees', {
      userId: state.empUser._id, employeeId: 'EMP002',
      department: 'Marketing', position: 'Designer',
      baseSalary: 5000, dateOfJoining: '2024-06-01',
    }, state.adminToken);
    assertStatus(res, 201);
    state.testEmp = res.data;
  });

  await test('Duplicate userId → fail', async () => {
    const res = await request('POST', '/employees', {
      userId: state.adminUser._id, employeeId: 'EMP999',
      department: 'X', position: 'X', baseSalary: 1, dateOfJoining: '2024-01-01',
    }, state.adminToken);
    assert(res.status >= 400, `Should reject duplicate userId, got: ${res.status}`);
  });

  await test('Duplicate employeeId → fail', async () => {
    const res = await request('POST', '/employees', {
      userId: '507f1f77bcf86cd799439099', employeeId: 'EMP001',
      department: 'X', position: 'X', baseSalary: 1, dateOfJoining: '2024-01-01',
    }, state.adminToken);
    assert(res.status >= 400, `Should reject duplicate EMP ID, got: ${res.status}`);
  });

  await test('Get all employees', async () => {
    const res = await request('GET', '/employees', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get employee by ID', async () => {
    const res = await request('GET', `/employees/${state.adminEmp._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get my profile', async () => {
    const res = await request('GET', '/employees/me', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Update employee', async () => {
    const res = await request('PUT', `/employees/${state.testEmp._id}`, {
      position: 'Senior Designer', baseSalary: 6000,
    }, state.adminToken);
    assertStatus(res, 200);
  });
}

// ═══════════════════════════════════════════
// 5. CLIENTS
// ═══════════════════════════════════════════
async function testClients() {
  console.log('\n🏢 CLIENTS MODULE');

  await test('Create client', async () => {
    const res = await request('POST', '/clients', {
      name: 'Acme Corp', email: 'acme@test.com', phone: '+1234',
      company: 'Acme', status: 'active', industry: 'Tech',
      contactPerson: 'John',
    }, state.adminToken);
    assertStatus(res, 201);
    state.client1 = res.data;
  });

  await test('Create second client', async () => {
    const res = await request('POST', '/clients', {
      name: 'Beta LLC', email: 'beta@test.com',
      company: 'Beta', status: 'lead',
    }, state.adminToken);
    assertStatus(res, 201);
    state.client2 = res.data;
  });

  await test('Get all clients', async () => {
    const res = await request('GET', '/clients', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get client by ID', async () => {
    const res = await request('GET', `/clients/${state.client1._id}`, null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.name === 'Acme Corp', 'Name mismatch');
  });

  await test('Update client', async () => {
    const res = await request('PUT', `/clients/${state.client2._id}`, {
      status: 'active',
    }, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Client stats', async () => {
    const res = await request('GET', '/clients/stats', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Invalid client ID → 400', async () => {
    const res = await request('GET', '/clients/bad-id', null, state.adminToken);
    assertStatus(res, 400);
  });
}

// ═══════════════════════════════════════════
// 6. PROJECTS
// ═══════════════════════════════════════════
async function testProjects() {
  console.log('\n📂 PROJECTS MODULE');

  await test('Create project', async () => {
    const res = await request('POST', '/projects', {
      name: 'Website Redesign', description: 'Client site revamp',
      clientId: state.client1._id, status: 'planning', priority: 'high',
      startDate: '2024-07-01', deadline: '2024-09-30', budget: 50000,
    }, state.adminToken);
    assertStatus(res, 201);
    state.project1 = res.data;
  });

  await test('Create second project', async () => {
    const res = await request('POST', '/projects', {
      name: 'SEO Campaign', description: 'Quarterly SEO',
      clientId: state.client2._id, priority: 'medium',
      startDate: '2024-08-01', deadline: '2024-12-31', budget: 20000,
    }, state.adminToken);
    assertStatus(res, 201);
    state.project2 = res.data;
  });

  await test('Get all projects', async () => {
    const res = await request('GET', '/projects', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get project by ID', async () => {
    const res = await request('GET', `/projects/${state.project1._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Update project', async () => {
    const res = await request('PUT', `/projects/${state.project1._id}`, {
      status: 'in-progress', spent: 5000,
    }, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Project stats', async () => {
    const res = await request('GET', '/projects/stats', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Assign team member', async () => {
    const res = await request('PUT', `/projects/${state.project1._id}`, {
      teamMembers: [state.testEmp._id],
    }, state.adminToken);
    assertStatus(res, 200);
  });
}

// ═══════════════════════════════════════════
// 7. TASKS
// ═══════════════════════════════════════════
async function testTasks() {
  console.log('\n📋 TASKS MODULE');

  await test('Create task', async () => {
    const res = await request('POST', '/tasks', {
      title: 'Design homepage', description: 'Mockup',
      projectId: state.project1._id, assignedTo: state.testEmp._id,
      priority: 'high', deadline: '2024-08-15', estimatedHours: 16,
    }, state.adminToken);
    assertStatus(res, 201);
    state.task1 = res.data;
  });

  await test('Create urgent task', async () => {
    const res = await request('POST', '/tasks', {
      title: 'Fix nav bug', projectId: state.project1._id,
      assignedTo: state.testEmp._id, priority: 'urgent',
      deadline: '2024-07-20', estimatedHours: 4,
    }, state.adminToken);
    assertStatus(res, 201);
    state.task2 = res.data;
  });

  await test('Get all tasks', async () => {
    const res = await request('GET', '/tasks', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get task by ID', async () => {
    const res = await request('GET', `/tasks/${state.task1._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Update task → in-progress', async () => {
    const res = await request('PUT', `/tasks/${state.task1._id}`, {
      status: 'in-progress', loggedHours: 4,
    }, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Update task → completed', async () => {
    const res = await request('PUT', `/tasks/${state.task2._id}`, {
      status: 'completed', loggedHours: 3,
    }, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Tasks by employee', async () => {
    const res = await request('GET', `/tasks/employee/${state.testEmp._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Task stats', async () => {
    const res = await request('GET', '/tasks/stats', null, state.adminToken);
    assertStatus(res, 200);
  });
}

// ═══════════════════════════════════════════
// 8. ATTENDANCE
// ═══════════════════════════════════════════
async function testAttendance() {
  console.log('\n⏰ ATTENDANCE MODULE');

  await test('Check in', async () => {
    const res = await request('POST', '/attendance/check-in', { notes: 'Hi' }, state.adminToken);
    assertStatus(res, 201);
    assert(res.data.checkIn, 'Missing checkIn');
    assert(res.data.status === 'present', 'Wrong status');
    state.attendance = res.data;
  });

  await test('Duplicate check-in → 400', async () => {
    const res = await request('POST', '/attendance/check-in', {}, state.adminToken);
    assertStatus(res, 400);
  });

  await test('Today status', async () => {
    const res = await request('GET', '/attendance/today', null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.checkedIn === true, 'Should be checked in');
    assert(res.data.checkedOut === false, 'Should not be checked out');
  });

  await test('Check out', async () => {
    const res = await request('POST', '/attendance/check-out', { notes: 'Bye' }, state.adminToken);
    assertStatus(res, 201);
    assert(res.data.checkOut, 'Missing checkOut');
    assert(typeof res.data.workingHours === 'number', 'Missing workingHours');
  });

  await test('Duplicate check-out → 400', async () => {
    const res = await request('POST', '/attendance/check-out', {}, state.adminToken);
    assertStatus(res, 400);
  });

  await test('Check-out before check-in → 400/404', async () => {
    const res = await request('POST', '/attendance/check-out', {}, state.empToken);
    assert(res.status === 400 || res.status === 404, `Got ${res.status}`);
  });

  await test('My attendance', async () => {
    const res = await request('GET', '/attendance/me', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('All attendance (admin)', async () => {
    const res = await request('GET', '/attendance', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Employee check-in', async () => {
    const res = await request('POST', '/attendance/check-in', {}, state.empToken);
    assertStatus(res, 201);
  });
}

// ═══════════════════════════════════════════
// 9. LEAVES
// ═══════════════════════════════════════════
async function testLeaves() {
  console.log('\n🏖️ LEAVES MODULE');

  await test('Apply annual leave', async () => {
    const res = await request('POST', '/leaves/apply', {
      type: 'annual', startDate: '2024-08-01', endDate: '2024-08-03',
      reason: 'Vacation',
    }, state.adminToken);
    assertStatus(res, 201);
    state.leave1 = res.data;
  });

  await test('Apply sick leave', async () => {
    const res = await request('POST', '/leaves/apply', {
      type: 'sick', startDate: '2024-09-10', endDate: '2024-09-11',
      reason: 'Flu',
    }, state.adminToken);
    assertStatus(res, 201);
    state.leave2 = res.data;
  });

  await test('My leaves', async () => {
    const res = await request('GET', '/leaves/me', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('All leaves', async () => {
    const res = await request('GET', '/leaves', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Approve leave', async () => {
    const res = await request('POST', `/leaves/${state.leave1._id}/approve`, {
      status: 'approved',
    }, state.adminToken);
    assertStatus(res, 201);
    assert(res.data.status === 'approved', 'Not approved');
  });

  await test('Reject leave', async () => {
    const res = await request('POST', `/leaves/${state.leave2._id}/approve`, {
      status: 'rejected', rejectionReason: 'Short notice',
    }, state.adminToken);
    assertStatus(res, 201);
    assert(res.data.status === 'rejected', 'Not rejected');
  });

  await test('Re-approve already processed → 400', async () => {
    const res = await request('POST', `/leaves/${state.leave1._id}/approve`, {
      status: 'rejected',
    }, state.adminToken);
    assertStatus(res, 400);
  });

  await test('Invalid leave type → 400', async () => {
    const res = await request('POST', '/leaves/apply', {
      type: 'invalid', startDate: '2024-10-01', endDate: '2024-10-02',
    }, state.adminToken);
    assertStatus(res, 400);
  });
}

// ═══════════════════════════════════════════
// 10. PAYROLL
// ═══════════════════════════════════════════
async function testPayroll() {
  console.log('\n💰 PAYROLL MODULE');
  const m = new Date().getMonth() + 1;
  const y = new Date().getFullYear();

  await test('Generate payroll', async () => {
    const res = await request('POST', '/payroll/generate', {
      employeeId: state.adminEmp._id, month: m, year: y,
      bonuses: 500, deductions: 100,
    }, state.adminToken);
    assertStatus(res, 201);
    state.payroll1 = res.data;
    assert(res.data.baseSalary === 15000, 'Wrong base');
    assert(res.data.status === 'draft', 'Wrong status');
  });

  await test('Duplicate payroll → 409', async () => {
    const res = await request('POST', '/payroll/generate', {
      employeeId: state.adminEmp._id, month: m, year: y,
    }, state.adminToken);
    assertStatus(res, 409);
  });

  await test('Get all payrolls', async () => {
    const res = await request('GET', '/payroll', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get payroll by ID', async () => {
    const res = await request('GET', `/payroll/${state.payroll1._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('My payroll', async () => {
    const res = await request('GET', '/payroll/me', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Mark payroll as paid', async () => {
    const res = await request('PUT', `/payroll/${state.payroll1._id}`, {
      status: 'paid',
    }, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.status === 'paid', 'Not paid');
  });

  await test('Get payslip', async () => {
    const res = await request('GET', `/payroll/${state.payroll1._id}/payslip`, null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.payslipId, 'Missing payslipId');
    assert(typeof res.data.netSalary === 'number', 'Missing netSalary');
  });

  await test('Salary formula validation', async () => {
    const p = state.payroll1;
    const expected = parseFloat((p.baseSalary + p.bonuses + p.overtimePay - p.deductions).toFixed(2));
    assert(Math.abs(p.netSalary - expected) < 0.01,
      `Net=${p.netSalary} != expected=${expected}`);
  });
}

// ═══════════════════════════════════════════
// 11. FINANCE
// ═══════════════════════════════════════════
async function testFinance() {
  console.log('\n💵 FINANCE MODULE');

  await test('Create income', async () => {
    const res = await request('POST', '/finance', {
      type: 'income', amount: 50000, category: 'Project',
      description: 'Website payment', date: '2024-07-15',
      projectId: state.project1?._id, clientId: state.client1?._id,
    }, state.adminToken);
    assertStatus(res, 201);
    state.income1 = res.data;
  });

  await test('Create expense', async () => {
    const res = await request('POST', '/finance', {
      type: 'expense', amount: 5000, category: 'Office',
      description: 'Supplies', date: '2024-07-20',
    }, state.adminToken);
    assertStatus(res, 201);
    state.expense1 = res.data;
  });

  await test('Get all transactions', async () => {
    const res = await request('GET', '/finance', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Get transaction by ID', async () => {
    const res = await request('GET', `/finance/${state.income1._id}`, null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Update transaction', async () => {
    const res = await request('PUT', `/finance/${state.expense1._id}`, {
      amount: 5500,
    }, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Delete transaction', async () => {
    const cr = await request('POST', '/finance', {
      type: 'expense', amount: 1, category: 'X',
      description: 'del', date: '2024-07-25',
    }, state.adminToken);
    if (cr.status === 201) {
      const res = await request('DELETE', `/finance/${cr.data._id}`, null, state.adminToken);
      assertStatus(res, 200);
    }
  });

  await test('Financial summary', async () => {
    const res = await request('GET', '/finance/summary', null, state.adminToken);
    assertStatus(res, 200);
  });
}

// ═══════════════════════════════════════════
// 12. DASHBOARD
// ═══════════════════════════════════════════
async function testDashboard() {
  console.log('\n📊 DASHBOARD MODULE');

  await test('Admin dashboard', async () => {
    const res = await request('GET', '/dashboard/admin', null, state.adminToken);
    assertStatus(res, 200);
    assert(res.data.stats, 'Missing stats');
    assert(res.data.finance, 'Missing finance');
  });

  await test('Employee dashboard', async () => {
    const res = await request('GET', '/dashboard/employee', null, state.adminToken);
    assertStatus(res, 200);
  });

  await test('Dashboard without auth → 401', async () => {
    const res = await request('GET', '/dashboard/admin');
    assertStatus(res, 401);
  });
}

// ═══════════════════════════════════════════
// 13. SECURITY
// ═══════════════════════════════════════════
async function testSecurity() {
  console.log('\n🛡️ SECURITY MODULE');

  await test('Invalid JWT rejected', async () => {
    const res = await request('GET', '/users', null, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJpYXQiOjE3MTJ9.fake');
    assertStatus(res, 401);
  });

  await test('DTO validation: empty body → 400', async () => {
    const res = await request('POST', '/clients', {}, state.adminToken);
    assertStatus(res, 400);
  });

  await test('forbidNonWhitelisted rejects extra fields', async () => {
    const res = await request('POST', '/auth/login', {
      email: 'admin@test.com', password: 'password123', hack: true,
    });
    assertStatus(res, 400);
  });

  await test('Employee cannot access admin routes', async () => {
    // Re-register a fresh Employee user
    const reg = await request('POST', '/auth/register', {
      name: 'Peon', email: 'peon@test.com', password: 'password123',
    });
    if (reg.status === 201) {
      const res = await request('GET', '/users', null, reg.data.token);
      assertStatus(res, 403);
    }
  });
}

// ═══════════════════════════════════════════
// 14. EDGE CASES
// ═══════════════════════════════════════════
async function testEdgeCases() {
  console.log('\n🔧 EDGE CASES');

  await test('Non-existent resource → 404', async () => {
    const res = await request('GET', '/projects/507f1f77bcf86cd799439011', null, state.adminToken);
    assertStatus(res, 404);
  });

  await test('Delete client', async () => {
    const cr = await request('POST', '/clients', {
      name: 'DelMe', email: 'del@test.com',
    }, state.adminToken);
    if (cr.status === 201) {
      const res = await request('DELETE', `/clients/${cr.data._id}`, null, state.adminToken);
      assertStatus(res, 200);
    }
  });

  await test('Large payload', async () => {
    const res = await request('POST', '/clients', {
      name: 'A'.repeat(1000), email: 'big@test.com', notes: 'B'.repeat(5000),
    }, state.adminToken);
    assert(res.status < 500, `Server error: ${res.status}`);
  });
}

// ═══════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  ERP FULL QA TEST SUITE v2');
  console.log('═══════════════════════════════════════════');
  try {
    console.log('\n⏳ Starting in-memory MongoDB...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    console.log(`✅ MongoDB: ${uri}`);

    process.env.MONGO_URI = uri;
    process.env.JWT_SECRET = 'test-secret-key-12345';
    process.env.JWT_EXPIRES_IN = '7d';
    process.env.PORT = '3001';
    process.env.CORS_ORIGIN = 'http://localhost:3000';

    console.log('⏳ Starting NestJS...');
    const { spawn } = require('child_process');
    serverProcess = spawn('node', ['dist/main.js'], {
      cwd: __dirname, env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let startupLog = '';
    serverProcess.stdout.on('data', d => { startupLog += d.toString(); });
    serverProcess.stderr.on('data', d => { startupLog += d.toString(); });

    await waitForServer();
    console.log('✅ Server ready!\n');

    await testAuth();
    await testRBAC();
    await testUsers();
    await testEmployees();
    await testClients();
    await testProjects();
    await testTasks();
    await testAttendance();
    await testLeaves();
    await testPayroll();
    await testFinance();
    await testDashboard();
    await testSecurity();
    await testEdgeCases();

  } catch (e) {
    console.error('\n💥 FATAL:', e.message);
  } finally {
    console.log('\n═══════════════════════════════════════════');
    console.log('  RESULTS');
    console.log('═══════════════════════════════════════════');
    console.log(`\n  Total:  ${totalTests}`);
    console.log(`  ✅ Pass: ${results.passed.length}`);
    console.log(`  ❌ Fail: ${results.failed.length}`);
    console.log(`  🐛 Bugs: ${results.bugs.length}`);

    if (results.failed.length > 0) {
      console.log('\n  ── FAILURES ──');
      results.failed.forEach((f, i) => console.log(`  ${i+1}. ${f.name}\n     → ${f.error}\n`));
    }
    if (results.bugs.length > 0) {
      console.log('\n  ── BUGS ──');
      results.bugs.forEach((b, i) => console.log(`  ${i+1}. [${b.severity}] ${b.module}: ${b.issue}\n     → ${b.detail}\n`));
    }
    console.log('\n═══════════════════════════════════════════');
    console.log(`  ${results.failed.length === 0 ? '✅ ALL TESTS PASSED' : `❌ ${results.failed.length} FAILURES`}`);
    console.log('═══════════════════════════════════════════\n');

    if (serverProcess) serverProcess.kill();
    if (mongod) await mongod.stop();
  }
}

main();
