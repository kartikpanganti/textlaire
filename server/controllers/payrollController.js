import Payroll from '../models/Payroll.js';
import Employee from '../models/Employee.js';
import Attendance from '../models/Attendance.js';
import mongoose from 'mongoose';

// Helper function to get the number of days in a month
const getDaysInMonth = (month, year) => {
  return new Date(year, month, 0).getDate();
};

// Helper function to synchronize payroll data with employee and attendance
const syncPayrollWithAttendance = async (employeeId, month, year) => {
  try {
    // Get employee data
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      throw new Error('Employee not found');
    }
    
    // Get attendance records for the month by payrollMonth and payrollYear
    // IMPORTANT: Only get records up to today's date (don't include future dates)
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // JS months are 0-indexed
    const currentDay = today.getDate();
    
    console.log(`Calculating payroll for ${employee.name} for month: ${month}/${year}`);
    console.log(`Current date: ${currentYear}-${currentMonth}-${currentDay}`);
    
    // Check if we're trying to calculate future months
    const isCurrentOrPastMonth = (parseInt(year) < currentYear) || 
                               (parseInt(year) === currentYear && parseInt(month) <= currentMonth);
    
    // For future months, use the employee's full salary instead of returning null
    if (!isCurrentOrPastMonth) {
      console.log(`Calculating future month payroll for ${month}/${year} using full salary`);
      
      // Create a basic payroll with the employee's full salary for future months
      let payroll = await Payroll.findOne({ employeeId, month, year });
      
      if (!payroll) {
        // Create new payroll for future month
        payroll = new Payroll({
          employeeId,
          month: parseInt(month),
          year: parseInt(year),
          employeeDetails: {
            name: employee.name,
            employeeID: employee.employeeID,
            department: employee.department,
            position: employee.position,
            joiningDate: employee.joiningDate,
            bankDetails: {
              bankName: employee.bankDetails?.bankName || employee.bankName || '',
              accountNumber: employee.bankDetails?.accountNumber || employee.accountNumber || '',
              accountHolderName: employee.bankDetails?.accountHolderName || employee.accountHolderName || employee.name || '',
              ifscCode: employee.bankDetails?.ifscCode || employee.ifscCode || ''
            }
          },
          basicSalary: employee.salary, // Full basic salary
          originalSalary: employee.salary // Store the original salary separately
        });
        
        // Set attendance for future months - perfect attendance
        const daysInFutureMonth = getDaysInMonth(parseInt(month), parseInt(year));
        payroll.attendanceSummary = {
          present: daysInFutureMonth,
          absent: 0,
          late: 0,
          onLeave: 0,
          workingDays: daysInFutureMonth,
          totalWorkingDays: daysInFutureMonth
        };
        
        // Set standard allowances based on the full salary
        payroll.allowances = {
          houseRent: employee.salary * 0.4, // 40% of basic salary
          medical: employee.salary * 0.1, // 10% of basic salary
          travel: employee.salary * 0.05, // 5% of basic salary
          food: employee.salary * 0.05, // 5% of basic salary
          special: 0,
          other: 0
        };
        
        // Calculate allowance total
        const allowanceTotal = 
          (payroll.allowances.houseRent || 0) +
          (payroll.allowances.medical || 0) +
          (payroll.allowances.travel || 0) +
          (payroll.allowances.food || 0) +
          (payroll.allowances.special || 0) +
          (payroll.allowances.other || 0);
        
        // Set deductions based on the full salary
        const healthInsuranceAmount = Math.min(15300 * 0.05, 1000); // 5% of salary up to 1000 max
        
        payroll.deductions = {
          professionalTax: 15, // Fixed at 15 rupees
          incomeTax: 0, // Fixed at 0 rupees
          providentFund: 48, // Fixed at 48 rupees
          healthInsurance: healthInsuranceAmount, // Proportional to salary
          loanRepayment: 0,
          absentDeduction: 0,
          lateDeduction: 0,
          other: 0
        };
        
        // Calculate deduction total
        const deductionTotal = 
          (payroll.deductions.professionalTax || 0) +
          (payroll.deductions.incomeTax || 0) +
          (payroll.deductions.providentFund || 0) +
          (payroll.deductions.healthInsurance || 0) +
          (payroll.deductions.loanRepayment || 0) +
          (payroll.deductions.absentDeduction || 0) +
          (payroll.deductions.lateDeduction || 0) +
          (payroll.deductions.other || 0);
        
        // Set overtime and totals
        payroll.overtime = { hours: 0, rate: 1.5, amount: 0 };
        payroll.bonus = 0;
        payroll.leaveDeduction = 0;
        
        // Calculate final figures
        payroll.grossSalary = 15300 + allowanceTotal;
        payroll.totalDeductions = deductionTotal;
        payroll.netSalary = payroll.grossSalary - payroll.totalDeductions;
        
        // Set payment details
        payroll.paymentStatus = 'Pending';
        payroll.paymentMethod = 'Bank Transfer';
        payroll.lastCalculated = new Date();
        
        await payroll.save();
      }
      
      return payroll;
    }
    
    // Check if the payroll month/year is before the employee's joining date
    const joiningDate = new Date(employee.joiningDate);
    const joiningYear = joiningDate.getFullYear();
    const joiningMonth = joiningDate.getMonth() + 1; // JS months are 0-indexed
    
    console.log(`Employee joining date: ${joiningMonth}/${joiningYear}`);
    
    const isAfterJoining = (parseInt(year) > joiningYear) || 
                           (parseInt(year) === joiningYear && parseInt(month) >= joiningMonth);
    
    // If the requested month is before the employee's joining date, return null
    if (!isAfterJoining) {
      console.log(`Cannot calculate payroll for ${month}/${year} as employee joined in ${joiningMonth}/${joiningYear}`);
      return null;
    }
    
    // Check if this is a past month
    const isPastMonth = (parseInt(year) < currentYear) || 
                     (parseInt(year) === currentYear && parseInt(month) < currentMonth);
    
    console.log(`Month status: ${isPastMonth ? 'Past month' : 'Current month'}`);
    
    // Try different query approaches for historical data
    let attendanceRecords = [];
    
    // First attempt - query by payrollMonth and payrollYear fields
    attendanceRecords = await Attendance.find({
      employeeId: employeeId,
      payrollMonth: parseInt(month),
      payrollYear: parseInt(year)
    });
    
    console.log(`Found ${attendanceRecords.length} records using payrollMonth/payrollYear fields`);
    
    // Second attempt - if no records found, try extracting month/year from date field
    if (attendanceRecords.length === 0) {
      // Get start and end date for the month
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0); // Last day of month
      
      // Format as YYYY-MM-DD strings
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log(`Trying date range query: ${startDateStr} to ${endDateStr}`);
      
      // Query by date range
      attendanceRecords = await Attendance.find({
        employeeId: employeeId,
        date: { $gte: startDateStr, $lte: endDateStr }
      });
      
      console.log(`Found ${attendanceRecords.length} records using date range query`);
    }
    
    // For past months, we should include all records
    // For current month, filter to only show up to today
    if (!isPastMonth && parseInt(year) === currentYear && parseInt(month) === currentMonth) {
      attendanceRecords = attendanceRecords.filter(record => {
        if (!record.date) return true;
        const recordDay = parseInt(record.date.split('-')[2]);
        return recordDay <= currentDay;
      });
      console.log(`Filtered current month records up to day ${currentDay}`);
    }
    
    console.log(`Found ${attendanceRecords.length} attendance records for employee ${employee.name} (${employee._id}) for ${month}/${year}`);
    
    // For past months with no attendance records, create demo data to show historical payrolls
    if (isPastMonth && attendanceRecords.length === 0) {
      console.log(`No historical records found for past month ${month}/${year}. Creating demo data.`);
      
      // Get the total days in this month for realistic attendance stats
      const daysInMonth = getDaysInMonth(parseInt(month), parseInt(year));
      
      // For demo purposes - create realistic attendance stats for past months
      // 80% present, 10% absent, 5% late, 5% leave
      const presentCount = Math.floor(daysInMonth * 0.8);
      const absentCount = Math.floor(daysInMonth * 0.1);
      const lateCount = Math.floor(daysInMonth * 0.05);
      const leaveCount = daysInMonth - presentCount - absentCount - lateCount;
      
      console.log(`Created demo attendance for ${month}/${year}: ${presentCount} present, ${absentCount} absent, ${lateCount} late, ${leaveCount} leave`);
      
      // Use these values for attendance summary
      const attendanceSummary = {
        present: presentCount,
        absent: absentCount,
        late: lateCount,
        onLeave: leaveCount,
        workingDays: daysInMonth,
        totalWorkingDays: daysInMonth
      };
      
      console.log(`Demo attendance summary: ${JSON.stringify(attendanceSummary)}`);
      return createDemoPayroll(employee, month, year, attendanceSummary);
    }
    
    // Handle missing attendance records for past dates
    const daysInMonth = getDaysInMonth(parseInt(month), parseInt(year));
    
    // Get a list of days that have attendance records
    const recordedDays = attendanceRecords.map(record => {
      return parseInt(record.date.split('-')[2]); // Get day part from YYYY-MM-DD
    });
    
    console.log(`Recorded days: ${recordedDays.join(', ')}`);
    
    // Find missing days (days that should have attendance but don't)
    const maxDay = isPastMonth ? daysInMonth : Math.min(daysInMonth, currentDay);
    const missingDays = [];
    
    for (let day = 1; day <= maxDay; day++) {
      if (!recordedDays.includes(day)) {
        missingDays.push(day);
      }
    }
    
    console.log(`Missing days: ${missingDays.join(', ')}`);
    
    // Count the missing days as "on leave" if they're in the past
    // For current month, only count missing days that are in the past (not today)
    const todayDay = new Date().getDate();
    const missingPastDays = missingDays.filter(day => {
      if (isPastMonth) return true;
      return day < todayDay; // For current month, only count days before today
    });
    
    console.log(`Missing past days (counted as on leave): ${missingPastDays.join(', ')}`);
    
    // For real attendance records, count actual statuses
    const presentDays = attendanceRecords.filter(record => record.status === 'Present').length;
    const absentDays = attendanceRecords.filter(record => record.status === 'Absent').length;
    const lateDays = attendanceRecords.filter(record => record.status === 'Late').length;
    
    // Add missing days as "on leave" days
    const recordedLeaveDays = attendanceRecords.filter(record => record.status === 'On Leave').length;
    const leaveDays = recordedLeaveDays + missingPastDays.length;
    
    // Total recorded days is the sum of all attendance records plus missing days
    const totalRecordedDays = presentDays + absentDays + lateDays + leaveDays;
    
    console.log(`Attendance breakdown - Present: ${presentDays}, Absent: ${absentDays}, Late: ${lateDays}, Leave: ${leaveDays} (including ${missingPastDays.length} missing days)`);
    
    // Use attendance data appropriately for current vs past months
    const attendanceSummary = {
      present: presentDays,
      absent: absentDays,
      late: lateDays,
      onLeave: leaveDays,
      workingDays: totalRecordedDays,
      totalWorkingDays: isPastMonth ? daysInMonth : Math.min(daysInMonth, currentDay)
    };
    
    console.log(`Attendance summary with missing days handled: ${JSON.stringify(attendanceSummary)}`);
    
    // Calculate overtime from actual attendance records only
    const overtimeRecords = attendanceRecords.filter(record => (record.overtimeHours || 0) > 0);
    const totalOvertimeHours = overtimeRecords.reduce((sum, record) => sum + (record.overtimeHours || 0), 0);
    const avgOvertimeRate = overtimeRecords.length > 0 ?
      overtimeRecords.reduce((sum, record) => sum + (record.overtimeRate || 1.5), 0) / overtimeRecords.length : 1.5;
    
    // Calculate salary based on attendance (only pay for days present)
    const dailyRate = 15300 / daysInMonth;
    let adjustedBasicSalary = 0;
    let leaveDeduction = 0;
    let lateDeduction = 0;
    
    // Special case for current month
    if (parseInt(year) === currentYear && parseInt(month) === currentMonth) {
      console.log(`Handling current month (${month}/${year}): Today is day ${currentDay} of the month`);
      
      // For current month, calculate based on days that have passed
      const totalDaysElapsed = currentDay;
      
      // Calculate adjusted salary based on attendance - deduct for missing days and absences
      adjustedBasicSalary = 15300 * (presentDays / totalDaysElapsed);
      console.log(`Adjusted salary for current month: ${adjustedBasicSalary} (based on ${presentDays}/${totalDaysElapsed} days)`);
      
      // Apply deductions
      lateDeduction = lateDays * (dailyRate * 0.25); // 25% deduction for late arrivals
      leaveDeduction = leaveDays * (dailyRate * 0.5); // 50% deduction for leave days
    } else {
      // For past months - adjust based on full month
      adjustedBasicSalary = 15300 * (presentDays / daysInMonth);
      console.log(`Adjusted salary for past month: ${adjustedBasicSalary} (based on ${presentDays}/${daysInMonth} days)`);
      
      // Apply deductions
      lateDeduction = lateDays * (dailyRate * 0.25); // 25% deduction for late arrivals
      leaveDeduction = leaveDays * (dailyRate * 0.5); // 50% deduction for leave days
    }
    
    // Find existing payroll or create a new one
    let payroll = await Payroll.findOne({ employeeId, month, year });
    
    if (!payroll) {
      // Create new payroll
      payroll = new Payroll({
        employeeId,
        month,
        year,
        employeeDetails: {
          name: employee.name,
          employeeID: employee.employeeID,
          department: employee.department,
          position: employee.position,
          joiningDate: employee.joiningDate,
          bankDetails: {
            bankName: employee.bankDetails?.bankName || employee.bankName || '',
            accountNumber: employee.bankDetails?.accountNumber || employee.accountNumber || '',
            accountHolderName: employee.bankDetails?.accountHolderName || employee.accountHolderName || employee.name || '',
            ifscCode: employee.bankDetails?.ifscCode || employee.ifscCode || ''
          }
        },
        attendanceSummary,
        basicSalary: adjustedBasicSalary, // Use attendance-adjusted salary
        attendanceRecords: attendanceRecords.map(record => record._id)
      });
    } else {
      // Update existing payroll
      payroll.employeeDetails = {
        name: employee.name,
        employeeID: employee.employeeID,
        department: employee.department,
        position: employee.position,
        joiningDate: employee.joiningDate,
        bankDetails: {
          bankName: employee.bankDetails?.bankName || employee.bankName || '',
          accountNumber: employee.bankDetails?.accountNumber || employee.accountNumber || '',
          accountHolderName: employee.bankDetails?.accountHolderName || employee.accountHolderName || employee.name || '',
          ifscCode: employee.bankDetails?.ifscCode || employee.ifscCode || ''
        }
      };
      payroll.attendanceSummary = attendanceSummary;
      payroll.basicSalary = adjustedBasicSalary; // Use attendance-adjusted salary
      payroll.attendanceRecords = attendanceRecords.map(record => record._id);
    }
    
    // Store the original salary for reference
    payroll.originalSalary = 15300;
    
    // Set standard allowances based on the adjusted salary
    payroll.allowances = {
      houseRent: adjustedBasicSalary * 0.4, // 40% of adjusted basic salary
      medical: adjustedBasicSalary * 0.1, // 10% of adjusted basic salary
      travel: adjustedBasicSalary * 0.05, // 5% of adjusted basic salary
      food: adjustedBasicSalary * 0.05, // 5% of adjusted basic salary
      special: 0,
      other: 0
    };
    
    // Set deductions based on the adjusted salary
    const healthInsuranceAmount = Math.min(adjustedBasicSalary * 0.05, 1000); // 5% of salary up to 1000 max
    
    payroll.deductions = {
      professionalTax: 15, // Fixed at 15 rupees
      incomeTax: 0, // Fixed at 0 rupees
      providentFund: 48, // Fixed at 48 rupees
      healthInsurance: healthInsuranceAmount, // Proportional to salary
      loanRepayment: 0, // Can be updated manually if needed
      absentDeduction: 0, // Already adjusted in the basic salary
      lateDeduction: lateDeduction,
      other: 0
    };
    
    // Set leave deduction separately
    payroll.leaveDeduction = leaveDeduction;
    
    // Set overtime based on the adjusted salary
    payroll.overtime = {
      hours: totalOvertimeHours,
      rate: avgOvertimeRate,
      amount: totalOvertimeHours * avgOvertimeRate * (adjustedBasicSalary / (22 * 8)) // Use adjusted salary
    };
    
    // Calculate gross salary and net salary but preserve manual edits if needed
    if (!payroll.manuallyEdited) {
      const allowanceTotal = 
        (payroll.allowances.houseRent || 0) +
        (payroll.allowances.medical || 0) +
        (payroll.allowances.travel || 0) +
        (payroll.allowances.food || 0) +
        (payroll.allowances.special || 0) +
        (payroll.allowances.other || 0);
      
      const deductionTotal = 
        (payroll.deductions.professionalTax || 0) +
        (payroll.deductions.incomeTax || 0) +
        (payroll.deductions.providentFund || 0) +
        (payroll.deductions.healthInsurance || 0) +
        (payroll.deductions.loanRepayment || 0) +
        (payroll.deductions.lateDeduction || 0) +
        (payroll.deductions.other || 0) +
        (payroll.leaveDeduction || 0);
      
      const overtimeAmount = payroll.overtime.amount || 0;
      
      payroll.grossSalary = adjustedBasicSalary + allowanceTotal + overtimeAmount;
      payroll.totalDeductions = deductionTotal;
      payroll.netSalary = payroll.grossSalary - payroll.totalDeductions;
    } else {
      console.log(`Preserving manually edited values for payroll ${payroll._id}`);
    }
    
    // Set the last calculation date
    payroll.lastCalculated = new Date();
    
    // Save payroll
    await payroll.save();
    
    return payroll;
  } catch (error) {
    console.error('Error syncing payroll with attendance:', error);
    throw error;
  }
};

// Helper function to create demo payroll for past months with no attendance records
const createDemoPayroll = async (employee, month, year, attendanceSummary) => {
  try {
    // Check if payroll already exists
    let payroll = await Payroll.findOne({ employeeId: employee._id, month, year });
    
    if (payroll) {
      console.log('Demo payroll already exists for this month/year');
      return payroll;
    }
    
    // Calculate original monthly salary (before proration)
    const originalSalary = employee.salary || 15300; // Default to 15300 if not set
    
    // Calculate the proration factor based on working days vs total days
    const daysInMonth = getDaysInMonth(parseInt(month), parseInt(year));
    const workingDays = attendanceSummary.present + attendanceSummary.late;
    const proratedFactor = Math.max(workingDays / daysInMonth, 0.1); // Minimum 10% to avoid zero 
    
    // Calculate the prorated basic salary
    const proratedBasic = originalSalary * proratedFactor;
    
    // Set up allowances based on the full salary (not prorated)
    const allowances = {
      houseRent: Math.round(originalSalary * 0.4 * proratedFactor * 100) / 100, // 40% of basic
      medical: Math.round(originalSalary * 0.1 * proratedFactor * 100) / 100, // 10% of basic
      travel: Math.round(originalSalary * 0.05 * proratedFactor * 100) / 100, // 5% of basic
      food: Math.round(originalSalary * 0.05 * proratedFactor * 100) / 100, // 5% of basic
      special: 0,
      other: 0
    };
    
    // Calculate attendance-based deductions
    const absentDeduction = attendanceSummary.absent * 100; // ₹100 per day
    const lateDeduction = attendanceSummary.late * 25; // ₹25 per day
    const leaveDeduction = attendanceSummary.onLeave * 45; // ₹45 per day
    
    // Set standard statutory deductions (prorated)
    const deductions = {
      professionalTax: Math.round(15 * proratedFactor), // Standard tax (prorated)
      incomeTax: 0, // No income tax in the example
      providentFund: Math.round(48 * proratedFactor), // Standard PF (prorated)
      healthInsurance: Math.round(20 * proratedFactor), // Standard health insurance (prorated)
      loanRepayment: 0,
      absentDeduction: absentDeduction,
      lateDeduction: lateDeduction,
      other: 0
    };
    
    // Calculate total allowances
    const totalAllowances = 
      allowances.houseRent + 
      allowances.medical + 
      allowances.travel + 
      allowances.food + 
      allowances.special + 
      allowances.other;
    
    // Calculate total deductions
    const totalDeductions = 
      deductions.professionalTax + 
      deductions.incomeTax + 
      deductions.providentFund + 
      deductions.healthInsurance + 
      deductions.loanRepayment + 
      deductions.absentDeduction + 
      deductions.lateDeduction + 
      deductions.other + 
      leaveDeduction;
    
    // Calculate gross salary (prorated basic + prorated allowances)
    const grossSalary = proratedBasic + totalAllowances;
    
    // Calculate net salary (gross - deductions)
    const netSalary = grossSalary - totalDeductions;
    
    // Create new payroll object
    payroll = new Payroll({
      employeeId: employee._id,
      month: parseInt(month),
      year: parseInt(year),
      employeeDetails: {
        name: employee.name,
        employeeID: employee.employeeID,
        department: employee.department,
        position: employee.position,
        joiningDate: employee.joiningDate,
        bankDetails: employee.bankDetails || {}
      },
      originalSalary: originalSalary, // Store the original full salary
      basicSalary: proratedBasic, // Store the prorated basic
      allowances,
      deductions,
      grossSalary,
      totalDeductions,
      netSalary,
      overtime: { hours: 0, rate: 1.5, amount: 0 },
      bonus: 0,
      leaveDeduction,
      paymentStatus: 'Pending',
      paymentMethod: 'Bank Transfer',
      attendanceSummary,
      lastCalculated: new Date(),
      isAutoGenerated: true
    });
    
    await payroll.save();
    console.log(`Demo payroll created for ${employee.name} for ${month}/${year}`);
    return payroll;
    
  } catch (error) {
    console.error('Error creating demo payroll:', error);
    throw error;
  }
};

// Helper function to calculate income tax (simplified example)
const calculateIncomeTax = (monthlySalary) => {
  const annualSalary = monthlySalary * 12;
  let tax = 0;
  
  if (annualSalary <= 250000) {
    tax = 0;
  } else if (annualSalary <= 500000) {
    tax = (annualSalary - 250000) * 0.05;
  } else if (annualSalary <= 750000) {
    tax = 12500 + (annualSalary - 500000) * 0.10;
  } else if (annualSalary <= 1000000) {
    tax = 37500 + (annualSalary - 750000) * 0.15;
  } else if (annualSalary <= 1250000) {
    tax = 75000 + (annualSalary - 1000000) * 0.20;
  } else if (annualSalary <= 1500000) {
    tax = 125000 + (annualSalary - 1250000) * 0.25;
  } else {
    tax = 187500 + (annualSalary - 1500000) * 0.30;
  }
  
  // Return monthly tax amount
  return tax / 12;
};

// Helper function for formatting decimal values
const formatToDecimal = (amount) => {
  return Math.round(amount * 100) / 100;
};

// Get all payrolls with filtering options and real-time generation
export const getPayrolls = async (req, res) => {
  try {
    const { month, year, employeeId, status } = req.query;
    
    // Default to current month and year if not specified
    const currentMonth = new Date().getMonth() + 1; // JS months are 0-indexed
    const currentYear = new Date().getFullYear();
    
    const payrollMonth = month ? parseInt(month) : currentMonth;
    const payrollYear = year ? parseInt(year) : currentYear;
    
    // Get all employees for auto-sync of payrolls
    let employees = [];
    if (employeeId) {
      // If employeeId is specified, only get that employee
      const employee = await Employee.findById(employeeId);
      if (employee) employees = [employee];
    } else {
      // Get all employees, not just active ones
      const allEmployees = await Employee.find({});
      
      // Then filter to only include employees who had joined by the requested month/year
      employees = allEmployees.filter(employee => {
        const joiningDate = new Date(employee.joiningDate);
        const joiningYear = joiningDate.getFullYear();
        const joiningMonth = joiningDate.getMonth() + 1; // JS months are 0-indexed
        
        // Employee is valid if they joined on or before the requested month/year
        return (joiningYear < payrollYear) || 
               (joiningYear === payrollYear && joiningMonth <= payrollMonth);
      });
      
      console.log(`Filtered ${allEmployees.length} total employees to ${employees.length} who had joined by ${payrollMonth}/${payrollYear}`);
    }
    
    // Sync payrolls for all retrieved employees
    const syncPromises = employees.map(employee => 
      syncPayrollWithAttendance(employee._id, payrollMonth, payrollYear)
        .catch(err => {
          console.error(`Error syncing payroll for employee ${employee.name}:`, err);
          return null; // Continue with other employees even if one fails
        })
    );
    
    await Promise.all(syncPromises);
    
    // Build filter object for fetching updated payrolls
    const filter = {
      month: payrollMonth,
      year: payrollYear
    };
    
    if (employeeId) filter.employeeId = employeeId;
    if (status) filter.paymentStatus = status;
    
    // Only allow admin to see all payrolls, employees can only see their own
    if (req.user && req.user.role !== 'admin') {
      // For managers, show all payrolls for employees in their departments
      if (req.user.role === 'manager') {
        // If we had department info, we'd use it here
        // For now, just allow managers to see all
        console.log('Manager accessing payrolls');
      } else {
        // Regular users can only see their own payrolls
        // But we need to find their employee record first (by email)
        try {
          // Find employee record matching the user's email
          const userEmail = req.user.email;
          console.log(`Finding employee record for user email: ${userEmail}`);
          
          const employeeRecord = await Employee.findOne({ email: userEmail });
          
          if (employeeRecord) {
            console.log(`Found matching employee record: ${employeeRecord._id} for user`);
            filter['employeeId'] = employeeRecord._id;
          } else {
            console.log(`No matching employee record found for user email: ${userEmail}`);
            // If no match found, use an impossible ID to ensure no records are returned
            // rather than showing other people's payrolls
            filter['employeeId'] = new mongoose.Types.ObjectId();
          }
        } catch (error) {
          console.error('Error matching user to employee:', error);
          // Use impossible ID if error occurs
          filter['employeeId'] = new mongoose.Types.ObjectId();
        }
      }
    }
    
    // Fetch all payrolls that match the filter
    let payrolls = await Payroll.find(filter).sort({ 'employeeDetails.name': 1 });
    
    // Get the valid employee IDs (those who had joined by the requested month)
    const validEmployeeIds = employees.map(emp => emp._id.toString());
    
    // Post-filter the payrolls to only include employees who had joined by the requested month
    // This ensures we don't show payrolls for employees who joined after the requested month
    const filteredPayrolls = payrolls.filter(payroll => {
      return validEmployeeIds.includes(payroll.employeeId.toString());
    });
    
    console.log(`Filtered payrolls from ${payrolls.length} to ${filteredPayrolls.length} based on joining date`);
    
    // Use the filtered payrolls
    payrolls = filteredPayrolls;
    
    return res.status(200).json({
      success: true,
      count: payrolls.length,
      data: payrolls,
      month: payrollMonth,
      year: payrollYear,
      lastCalculated: new Date()
    });
  } catch (error) {
    console.error("Error fetching payrolls:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Get a specific payroll by ID
export const getPayrollById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate that id is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID format"
      });
    }
    
    // Find payroll
    const payroll = await Payroll.findById(id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found"
      });
    }
    
    // Check permission: only admin, the employee themselves, or a manager can view a payroll
    if (req.user && req.user.role !== 'admin') {
      // For regular users, verify this is their own payroll by comparing emails
      if (req.user.role === 'user') {
        try {
          // Find the employee record that matches the user's email
          const userEmail = req.user.email;
          console.log(`Finding employee record for user email: ${userEmail}`);
          
          const employeeRecord = await Employee.findOne({ email: userEmail });
          
          if (employeeRecord) {
            console.log(`Found matching employee record: ${employeeRecord._id} for user`);
            if (payroll.employeeId.toString() !== employeeRecord._id.toString()) {
              return res.status(403).json({
                success: false,
                message: "Access denied: You can only view your own payroll records"
              });
            }
          } else {
            console.log(`No matching employee record found for user email: ${userEmail}`);
            // If no match found, use an impossible ID to ensure no records are returned
            // rather than showing other people's payrolls
            return res.status(403).json({
              success: false,
              message: "Access denied: You can only view your own payroll records"
            });
          }
        } catch (error) {
          console.error('Error matching user to employee:', error);
          return res.status(500).json({
            success: false,
            message: "Error verifying user permissions"
          });
        }
      }
      // For managers, we allow access to all (could be restricted to department in a future update)
    }
    
    console.log(`Fetching detailed payroll for ID: ${id}, Employee: ${payroll.employeeId}, Period: ${payroll.month}/${payroll.year}`);
    
    // Sync payroll with current employee and attendance data
    const updatedPayroll = await syncPayrollWithAttendance(payroll.employeeId, payroll.month, payroll.year);
    
    // Our updated syncPayrollWithAttendance now handles future months properly
    // so this conditional is redundant but kept for safety
    if (!updatedPayroll) {
      return res.status(200).json({
        success: true,
        message: "Could not process payroll for this period",
        data: payroll // Return original payroll without updates
      });
    }
    
    return res.status(200).json({
      success: true,
      data: payroll,
      lastCalculated: new Date()
    });
  } catch (error) {
    console.error("Error fetching payroll:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Generate payroll for a single employee
export const generatePayroll = async (req, res) => {
  try {
    const { employeeId, month, year } = req.body;
    
    // Validate inputs
    if (!employeeId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID, month, and year are required'
      });
    }
    
    // Check if payroll already exists
    const existingPayroll = await Payroll.findOne({ 
      employeeId, 
      month: parseInt(month), 
      year: parseInt(year) 
    });
    
    if (existingPayroll) {
      return res.status(400).json({
        success: false,
        message: 'Payroll already exists for this employee for the specified month'
      });
    }
    
    // Get employee details
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Get attendance data for this month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];
    
    console.log(`Searching for attendance records from ${formattedStartDate} to ${formattedEndDate}`);
    
    // Get attendance records for this period
    const attendanceRecords = await Attendance.find({
      employeeId,
      date: { 
        $gte: formattedStartDate, 
        $lte: formattedEndDate 
      }
    });
    
    console.log(`Found ${attendanceRecords.length} attendance records`);
    
    // Calculate attendance summary
    const daysInMonth = getDaysInMonth(month, year);
    
    // Initialize summary
    let present = 0;
    let absent = 0;
    let late = 0;
    let onLeave = 0;
    
    // Process attendance records
    attendanceRecords.forEach(record => {
      if (record.status === 'Present') {
        present++;
      } else if (record.status === 'Absent') {
        absent++;
      } else if (record.status === 'Late') {
        late++;
      } else if (record.status === 'On Leave') {
        onLeave++;
      }
    });
    
    // Calculate the total days accounted for
    const totalDaysAccountedFor = present + absent + late + onLeave;
    
    // For days not accounted for, mark as absent
    const unaccountedDays = Math.max(0, daysInMonth - totalDaysAccountedFor);
    absent += unaccountedDays;
    
    // Calculate original monthly salary (before proration)
    const originalSalary = employee.salary || 15300; // Default to 15300 if not set
    
    // Calculate working days and proration factor
    const workingDays = present + late;
    const proratedFactor = Math.max(workingDays / daysInMonth, 0.1); // At least 10% to avoid zero
    
    // Calculate the prorated basic salary
    const proratedBasic = originalSalary * proratedFactor;
    
    // Set up allowances based on the original salary (but prorated)
    const allowances = {
      houseRent: Math.round(originalSalary * 0.4 * proratedFactor * 100) / 100, // 40% of basic
      medical: Math.round(originalSalary * 0.1 * proratedFactor * 100) / 100, // 10% of basic
      travel: Math.round(originalSalary * 0.05 * proratedFactor * 100) / 100, // 5% of basic
      food: Math.round(originalSalary * 0.05 * proratedFactor * 100) / 100, // 5% of basic
      special: 0,
      other: 0
    };
    
    // Calculate deductions
    const absentDeduction = absent * 100; // ₹100 per day
    const lateDeduction = late * 25; // ₹25 per day
    const leaveDeduction = onLeave * 45; // ₹45 per day
    
    // Set standard statutory deductions (prorated)
    const deductions = {
      professionalTax: Math.round(15 * proratedFactor), // ₹15 (prorated)
      incomeTax: 0, // ₹0
      providentFund: Math.round(48 * proratedFactor), // ₹48 (prorated)
      healthInsurance: Math.round(20 * proratedFactor), // ₹20 (prorated)
      loanRepayment: 0,
      absentDeduction: absentDeduction,
      lateDeduction: lateDeduction,
      other: 0
    };
    
    // Calculate totals
    const totalAllowances = Object.values(allowances).reduce((a, b) => a + b, 0);
    const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0) + leaveDeduction;
    
    // Calculate gross and net salary
    const grossSalary = proratedBasic + totalAllowances;
    const netSalary = grossSalary - totalDeductions;
    
    // Create new payroll
    const newPayroll = new Payroll({
      employeeId,
      month: parseInt(month),
      year: parseInt(year),
      employeeDetails: {
        name: employee.name,
        employeeID: employee.employeeID,
        department: employee.department,
        position: employee.position,
        joiningDate: employee.joiningDate,
        bankDetails: {
          bankName: employee.bankDetails?.bankName || employee.bankName || '',
          accountNumber: employee.bankDetails?.accountNumber || employee.accountNumber || '',
          accountHolderName: employee.bankDetails?.accountHolderName || employee.accountHolderName || employee.name || '',
          ifscCode: employee.bankDetails?.ifscCode || employee.ifscCode || ''
        }
      },
      attendanceSummary: {
        present,
        absent,
        late,
        onLeave,
        workingDays,
        totalWorkingDays: daysInMonth
      },
      originalSalary: originalSalary, // Store the original full salary
      basicSalary: proratedBasic, // Store the prorated basic
      allowances,
      deductions,
      leaveDeduction,
      overtime: { hours: 0, rate: 1.5, amount: 0 },
      bonus: 0,
      grossSalary,
      totalDeductions,
      netSalary,
      paymentStatus: 'Pending',
      paymentMethod: 'Bank Transfer',
      createdBy: req.user ? req.user._id : null,
      lastCalculated: new Date()
    });
    
    // Save payroll
    await newPayroll.save();
    
    // Add payroll ID to attendance records
    await Attendance.updateMany(
      { _id: { $in: attendanceRecords.map(r => r._id) } },
      { $set: { payrollId: newPayroll._id } }
    );
    
    return res.status(201).json({
      success: true,
      message: 'Payroll generated successfully',
      data: newPayroll
    });
    
  } catch (error) {
    console.error('Error generating payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while generating payroll',
      error: error.message
    });
  }
};

// Generate payroll for all employees
export const generateBulkPayroll = async (req, res) => {
  try {
    // Only admin can generate payrolls
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied: Admin privileges required"
      });
    }
    
    const { month, year } = req.body;
    
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year are required"
      });
    }
    
    // Get all employees, not just active ones
    const employees = await Employee.find({});
    
    if (employees.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No employees found"
      });
    }
    
    // Check which employees already have payrolls for this month/year
    const existingPayrolls = await Payroll.find({
      month: parseInt(month),
      year: parseInt(year)
    }).select('employeeId');
    
    const existingEmployeeIds = existingPayrolls.map(p => p.employeeId.toString());
    
    // Filter out employees who already have payrolls
    const employeesToProcess = employees.filter(emp => 
      !existingEmployeeIds.includes(emp._id.toString())
    );
    
    if (employeesToProcess.length === 0) {
      return res.status(400).json({
        success: false,
        message: "All employees already have payrolls for this month/year"
      });
    }
    
    // Generate payrolls for remaining employees
    const payrollsToCreate = employeesToProcess.map(employee => {
      // Use employee.baseSalary or default to 0 if not set
      const basicSalary = employee.baseSalary || 0;
      
      // Calculate auto values based on basic salary
      const houseRent = basicSalary * 0.4; // 40% of basic
      const medical = basicSalary * 0.1; // 10% of basic
      const travel = basicSalary * 0.05; // 5% of basic
      const food = basicSalary * 0.05; // 5% of basic
      const professionalTax = basicSalary > 15000 ? 200 : 150; // Example tax rule
      const providentFund = basicSalary * 0.12; // 12% of basic
      const healthInsuranceAmount = Math.min(basicSalary * 0.05, 1000); // 5% of salary up to 1000 max
      const incomeTax = calculateIncomeTax(basicSalary);
      
      // Calculate totals correctly
      const allowanceTotal = houseRent + medical + travel + food;
      const deductionTotal = professionalTax + providentFund + healthInsuranceAmount + incomeTax;
      
      const grossSalary = basicSalary + allowanceTotal;
      const netSalary = grossSalary - deductionTotal;
      
      // Get the days in this month for attendance summary
      const daysInMonth = getDaysInMonth(parseInt(month), parseInt(year));
      
      return {
        employeeId: employee._id,
        month: parseInt(month),
        year: parseInt(year),
        basicSalary,
        allowances: {
          houseRent,
          medical,
          travel,
          food,
          special: 0,
          other: 0
        },
        deductions: {
          professionalTax,
          providentFund,
          incomeTax,
          healthInsurance: healthInsuranceAmount,
          loanRepayment: 0,
          absentDeduction: 0,
          lateDeduction: 0,
          other: 0
        },
        overtime: {
          hours: 0,
          rate: 1.5,
          amount: 0
        },
        bonus: 0,
        leaveDeduction: 0,
        grossSalary,
        totalDeductions: deductionTotal,
        netSalary,
        attendanceSummary: {
          present: daysInMonth,
          absent: 0,
          late: 0,
          onLeave: 0,
          workingDays: daysInMonth,
          totalWorkingDays: daysInMonth
        },
        generatedBy: req.user.userId,
        employeeDetails: {
          name: employee.name,
          employeeID: employee.employeeID,
          department: employee.department,
          position: employee.position,
          joiningDate: employee.joiningDate,
          bankDetails: {
            bankName: employee.bankDetails?.bankName || employee.bankName || '',
            accountNumber: employee.bankDetails?.accountNumber || employee.accountNumber || '',
            accountHolderName: employee.bankDetails?.accountHolderName || employee.accountHolderName || employee.name || '',
            ifscCode: employee.bankDetails?.ifscCode || employee.ifscCode || ''
          }
        }
      };
    });
    
    // Save all payrolls
    const createdPayrolls = await Payroll.insertMany(payrollsToCreate);
    
    return res.status(201).json({
      success: true,
      message: `Generated ${createdPayrolls.length} payrolls successfully`,
      processed: createdPayrolls.length,
      skipped: existingEmployeeIds.length,
      data: createdPayrolls
    });
  } catch (error) {
    console.error("Error generating bulk payrolls:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Update payroll payment status
export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus, paymentMethod, remarks, paymentDate } = req.body;
    
    // Find the payroll record
    const payroll = await Payroll.findById(id);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found"
      });
    }

    // First, sync with latest attendance data
    await syncPayrollWithAttendance(payroll.employeeId, payroll.month, payroll.year);
    
    // Fetch the updated payroll and then update payment details
    const updatedPayroll = await Payroll.findById(id);
    
    // Update payment details
    updatedPayroll.paymentStatus = paymentStatus;
    if (paymentMethod) updatedPayroll.paymentMethod = paymentMethod;
    if (remarks) updatedPayroll.remarks = remarks;
    
    // Set payment date if provided, or set it to today if status is changing to Paid and no date is provided
    if (paymentDate) {
      updatedPayroll.paymentDate = new Date(paymentDate);
    } else if (paymentStatus === 'Paid' && (updatedPayroll.paymentStatus !== 'Paid' || !updatedPayroll.paymentDate)) {
      updatedPayroll.paymentDate = new Date();
    }
    
    // If status is not Paid, allow clearing the payment date
    if (paymentStatus !== 'Paid' && paymentDate === '') {
      updatedPayroll.paymentDate = null;
    }
    
    await updatedPayroll.save();
    
    return res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      data: updatedPayroll
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update payment status",
      error: error.message
    });
  }
};

// Batch update payment status for multiple payrolls
export const batchUpdatePaymentStatus = async (req, res) => {
  try {
    // Only admin can update payment status
    if (req.user && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied: Admin privileges required"
      });
    }
    
    const { payrollIds, paymentStatus, paymentMethod, paymentDate, remarks } = req.body;
    
    if (!payrollIds || !Array.isArray(payrollIds) || payrollIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No payroll IDs provided"
      });
    }
    
    if (!paymentStatus) {
      return res.status(400).json({
        success: false,
        message: "Payment status is required"
      });
    }
    
    if (!['Pending', 'Processing', 'Paid', 'Failed'].includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status"
      });
    }
    
    const updatePromises = payrollIds.map(async (id) => {
      try {
        // Find the payroll
        const payroll = await Payroll.findById(id);
        
        if (!payroll) {
          return { id, success: false, message: "Payroll not found" };
        }
        
        // Update payment details
        payroll.paymentStatus = paymentStatus;
        if (paymentMethod) payroll.paymentMethod = paymentMethod;
        if (remarks) payroll.remarks = remarks;
        
        // Set payment date if provided, or set it to today if status is changing to Paid and no date is provided
        if (paymentDate) {
          payroll.paymentDate = new Date(paymentDate);
        } else if (paymentStatus === 'Paid' && (payroll.paymentStatus !== 'Paid' || !payroll.paymentDate)) {
          payroll.paymentDate = new Date();
        }
        
        // If status is not Paid, allow clearing the payment date
        if (paymentStatus !== 'Paid' && paymentDate === '') {
          payroll.paymentDate = null;
        }
        
        await payroll.save();
        return { id, success: true };
      } catch (error) {
        console.error(`Error updating payroll ${id}:`, error);
        return { id, success: false, message: error.message };
      }
    });
    
    const results = await Promise.all(updatePromises);
    const success = results.every(result => result.success);
    const successCount = results.filter(result => result.success).length;
    
    if (success) {
      return res.status(200).json({
        success: true,
        message: `Successfully updated ${successCount} payroll records`,
        results
      });
    } else {
      return res.status(207).json({
        success: false,
        message: `Updated ${successCount} out of ${payrollIds.length} payroll records`,
        results
      });
    }
  } catch (error) {
    console.error("Error in batch update payment status:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Update payroll details
export const updatePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      basicSalary,
      allowances,
      deductions,
      overtime,
      bonus,
      leaveDeduction,
      paymentStatus,
      paymentMethod,
      paymentDate,
      remarks
    } = req.body;
    
    // Find the payroll first
    const payroll = await Payroll.findById(id);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found"
      });
    }
    
    // Check permissions for updating payroll
    if (req.user) {
      // Admin can update any payroll
      if (req.user.role === 'admin') {
        // Admin has full access, continue
      } 
      // Managers can update payrolls for their team
      else if (req.user.role === 'manager') {
        // For now, allow managers to update all payrolls
        // In the future, restrict to their department
      } 
      // Regular users can only update their own payroll if it's not paid
      else if (req.user.role === 'user') {
        if (payroll.employeeId.toString() !== req.user.userId) {
          return res.status(403).json({
            success: false,
            message: "Access denied: You can only update your own payroll records"
          });
        }
        
        // Users can't change payment status
        if (paymentStatus && paymentStatus !== payroll.paymentStatus) {
          return res.status(403).json({
            success: false,
            message: "Access denied: You cannot change payment status"
          });
        }
      }
    }
    
    // Allow updates for any status - removed the paid status restriction
    
    // Update fields if provided
    if (basicSalary) payroll.basicSalary = parseFloat(basicSalary);
    
    if (allowances) {
      if (allowances.houseRent !== undefined) payroll.allowances.houseRent = parseFloat(allowances.houseRent);
      if (allowances.medical !== undefined) payroll.allowances.medical = parseFloat(allowances.medical);
      if (allowances.travel !== undefined) payroll.allowances.travel = parseFloat(allowances.travel);
      if (allowances.food !== undefined) payroll.allowances.food = parseFloat(allowances.food);
      if (allowances.special !== undefined) payroll.allowances.special = parseFloat(allowances.special);
      if (allowances.other !== undefined) payroll.allowances.other = parseFloat(allowances.other);
    }
    
    if (deductions) {
      if (deductions.professionalTax !== undefined) payroll.deductions.professionalTax = parseFloat(deductions.professionalTax);
      if (deductions.incomeTax !== undefined) payroll.deductions.incomeTax = parseFloat(deductions.incomeTax);
      if (deductions.providentFund !== undefined) payroll.deductions.providentFund = parseFloat(deductions.providentFund);
      if (deductions.healthInsurance !== undefined) payroll.deductions.healthInsurance = parseFloat(deductions.healthInsurance);
      if (deductions.loanRepayment !== undefined) payroll.deductions.loanRepayment = parseFloat(deductions.loanRepayment);
      if (deductions.other !== undefined) payroll.deductions.other = parseFloat(deductions.other);
    }
    
    if (overtime) {
      if (overtime.hours !== undefined) payroll.overtime.hours = parseFloat(overtime.hours);
      if (overtime.rate !== undefined) payroll.overtime.rate = parseFloat(overtime.rate);
      if (overtime.amount !== undefined) payroll.overtime.amount = parseFloat(overtime.amount);
      else payroll.overtime.amount = parseFloat((payroll.overtime.hours * payroll.overtime.rate).toFixed(2));
    }
    
    if (bonus !== undefined) payroll.bonus = parseFloat(bonus);
    if (leaveDeduction !== undefined) payroll.leaveDeduction = parseFloat(leaveDeduction);
    
    // Update payment information
    if (paymentStatus) payroll.paymentStatus = paymentStatus;
    if (paymentMethod) payroll.paymentMethod = paymentMethod;
    if (paymentDate) payroll.paymentDate = new Date(paymentDate);
    if (remarks !== undefined) payroll.remarks = remarks;
    
    // If status is not Paid and paymentDate is empty string, clear the payment date
    if (paymentStatus !== 'Paid' && paymentDate === '') {
      payroll.paymentDate = null;
    }
    
    // Mark payroll as manually edited to prevent automatic recalculation
    payroll.manuallyEdited = true;
    
    // Recalculate gross salary and net salary
    const allowanceTotal = formatToDecimal(
      (payroll.allowances.houseRent || 0) +
      (payroll.allowances.medical || 0) +
      (payroll.allowances.travel || 0) +
      (payroll.allowances.food || 0) +
      (payroll.allowances.special || 0) +
      (payroll.allowances.other || 0)
    );
    
    const deductionTotal = formatToDecimal(
      (payroll.deductions.professionalTax || 0) +
      (payroll.deductions.incomeTax || 0) +
      (payroll.deductions.providentFund || 0) +
      (payroll.deductions.healthInsurance || 0) +
      (payroll.deductions.loanRepayment || 0) +
      (payroll.deductions.other || 0)
    );
    
    payroll.grossSalary = formatToDecimal(
      (payroll.basicSalary || 0) + allowanceTotal + (payroll.bonus || 0) + (payroll.overtime?.amount || 0)
    );
    payroll.totalDeductions = formatToDecimal(deductionTotal + (payroll.leaveDeduction || 0));
    payroll.netSalary = formatToDecimal(payroll.grossSalary - payroll.totalDeductions);
    
    await payroll.save();
    
    return res.status(200).json({
      success: true,
      message: "Payroll updated successfully",
      data: payroll
    });
  } catch (error) {
    console.error("Error updating payroll:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Delete payroll
export const deletePayroll = async (req, res) => {
  try {
    // Only admin can delete payroll
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Access denied: Admin privileges required"
      });
    }
    
    const { id } = req.params;
    
    const payroll = await Payroll.findById(id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found"
      });
    }
    
    // Don't allow deleting if already paid
    if (payroll.paymentStatus === 'Paid') {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a payroll that has already been paid"
      });
    }
    
    await Payroll.findByIdAndDelete(id);
    
    return res.status(200).json({
      success: true,
      message: "Payroll deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting payroll:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Get payroll summary (for admin dashboard)
export const getPayrollSummary = async (req, res) => {
  try {
    // Removed admin-only check to allow all users to view summary
    const { month, year } = req.query;
    
    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year are required"
      });
    }
    
    const payrollMonth = parseInt(month);
    const payrollYear = parseInt(year);
    
    // Validate month and year formats
    if (isNaN(payrollMonth) || payrollMonth < 1 || payrollMonth > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid month format. Month must be between 1-12."
      });
    }
    
    if (isNaN(payrollYear) || payrollYear < 2020 || payrollYear > 2100) {
      return res.status(400).json({
        success: false,
        message: "Invalid year format. Year must be between 2020-2100."
      });
    }
    
    // Get employees count
    const totalEmployees = await Employee.countDocuments({ status: 'Active' });
    
    // Sync all employee payrolls for the selected month and year
    const employees = await Employee.find({});
    console.log(`Syncing payrolls for ${employees.length} employees for ${payrollMonth}/${payrollYear}`);
    
    // First pass: sync all payrolls
    for (const employee of employees) {
      try {
        // For historical data processing - check if we have attendance records
        const attendanceCount = await Attendance.countDocuments({
          employeeId: employee._id,
          payrollMonth: payrollMonth,
          payrollYear: payrollYear
        });
        
        console.log(`Employee ${employee.name} has ${attendanceCount} attendance records for ${payrollMonth}/${payrollYear}`);
        
        // Even if no attendance records, always attempt to sync the payroll
        // This will ensure we handle historical data properly
        await syncPayrollWithAttendance(employee._id, payrollMonth, payrollYear);
      } catch (error) {
        console.error(`Error syncing payroll for employee ${employee.name}:`, error);
      }
    }
    
    // Get updated payroll stats for the month
    const payrolls = await Payroll.find({
      month: payrollMonth,
      year: payrollYear
    });
    
    const processedCount = payrolls.length;
    
    const pendingCount = payrolls.filter(p => p.paymentStatus === 'Pending').length;
    const processingCount = payrolls.filter(p => p.paymentStatus === 'Processing').length;
    const paidCount = payrolls.filter(p => p.paymentStatus === 'Paid').length;
    const failedCount = payrolls.filter(p => p.paymentStatus === 'Failed').length;
    
    // Calculate financial totals with proper decimal formatting
    const formatToDecimal = (amount) => Math.round(amount * 100) / 100;
    
    const totalPayroll = formatToDecimal(
      payrolls.reduce((sum, p) => sum + p.netSalary, 0)
    );
    
    const totalNetPayout = formatToDecimal(
      payrolls.reduce((sum, p) => sum + p.netSalary, 0)
    );
    
    const totalDeductions = formatToDecimal(
      payrolls.reduce((sum, p) => sum + p.totalDeductions, 0)
    );
    
    return res.status(200).json({
      success: true,
      data: {
        totalEmployees,
        processedCount,
        pendingCount,
        processingCount,
        paidCount,
        failedCount,
        notProcessedCount: totalEmployees - processedCount,
        totalPayroll,
        totalNetPayout,
        totalDeductions,
        month: parseInt(month),
        year: parseInt(year),
        lastCalculated: new Date()
      }
    });
  } catch (error) {
    console.error("Error getting payroll summary:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Generate payroll reports with enhanced analytics for charts and visualizations
export const generatePayrollReports = async (req, res) => {
  try {
    const { startDate, endDate, departments, format } = req.query;
    
    console.log('Generating payroll reports with params:', req.query);
    
    // Build filter query
    const filter = {};
    
    // Date range filtering
    if (startDate || endDate) {
      // Parse dates
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      
      console.log(`Date filtering: ${start ? start.toISOString() : 'none'} to ${end ? end.toISOString() : 'none'}`);
      
      if (start && end) {
        // Filter by date range
        filter.createdAt = { $gte: start, $lte: end };
      } else if (start) {
        filter.createdAt = { $gte: start };
      } else if (end) {
        filter.createdAt = { $lte: end };
      }
    }
    
    // Department filtering
    if (departments) {
      const deptArray = departments.split(',');
      filter['employeeDetails.department'] = { $in: deptArray };
      console.log(`Department filtering: ${deptArray.join(', ')}`);
    }
    
    // Parse dates for month/year based filtering
    const parsedStartDate = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1); // Default to Jan 1 of current year
    const parsedEndDate = endDate ? new Date(endDate) : new Date(); // Default to current date
    
    // Build base query for month/year filtering
    let query = {};
    
    // Add date range using month and year fields
    const startMonth = parsedStartDate.getMonth() + 1;
    const startYear = parsedStartDate.getFullYear();
    const endMonth = parsedEndDate.getMonth() + 1;
    const endYear = parsedEndDate.getFullYear();
    
    // Construct query for date range using month/year fields
    if (startYear === endYear) {
      query.year = startYear;
      query.month = { $gte: startMonth, $lte: endMonth };
    } else {
      // Complex condition for multi-year ranges
      query.$or = [
        { year: startYear, month: { $gte: startMonth } },
        { year: { $gt: startYear, $lt: endYear } },
        { year: endYear, month: { $lte: endMonth } }
      ];
    }
    
    // Add department filter if provided
    if (departments) {
      // Already created deptArray above, reuse that
      query['employeeDetails.department'] = { $in: departments.split(',') };
    }
    
    // Fetch payrolls
    const payrolls = await Payroll.find(query).sort({ year: 1, month: 1 });
    
    // Enhanced analytics for dashboard and visualization
    const analytics = {
      // Basic metrics
      totalEmployees: new Set(payrolls.map(p => p.employeeId.toString())).size,
      totalPayroll: payrolls.reduce((sum, p) => sum + p.netSalary, 0),
      avgSalary: payrolls.length > 0 ? payrolls.reduce((sum, p) => sum + p.netSalary, 0) / payrolls.length : 0,
      
      // Financial metrics
      totalGrossSalary: payrolls.reduce((sum, p) => sum + (p.grossSalary || 0), 0),
      totalNetSalary: payrolls.reduce((sum, p) => sum + (p.netSalary || 0), 0),
      totalBasicSalary: payrolls.reduce((sum, p) => sum + (p.basicSalary || 0), 0),
      
      // Deduction metrics
      totalDeductions: payrolls.reduce((sum, p) => sum + (p.totalDeductions || 0), 0),
      taxDeductions: payrolls.reduce((sum, p) => sum + (p.deductions?.incomeTax || 0), 0),
      pfDeductions: payrolls.reduce((sum, p) => sum + (p.deductions?.providentFund || 0), 0),
      otherDeductions: payrolls.reduce((sum, p) => sum + (
        (p.deductions?.healthInsurance || 0) + 
        (p.deductions?.professionalTax || 0) + 
        (p.deductions?.loanRepayment || 0) + 
        (p.deductions?.other || 0)
      ), 0),
      
      // Bonus and incentive metrics
      bonusDistributed: payrolls.reduce((sum, p) => sum + (p.bonus || 0), 0),
      incentivesDistributed: payrolls.reduce((sum, p) => sum + ((p.bonusDetails?.incentives || 0) + (p.bonusDetails?.commission || 0)), 0),
      
      // Overtime metrics
      overtimeHoursTotal: payrolls.reduce((sum, p) => sum + (p.overtime?.hours || 0), 0),
      overtimeAmountTotal: payrolls.reduce((sum, p) => sum + (p.overtime?.amount || 0), 0),
      
      // Collections for detailed reporting
      salaryByDepartment: {},
      salaryByPosition: {},
      salaryTrend: [],
      allocationByComponent: {},
      deductionBreakdown: {},
      employeePerformance: []
    };
    
    // Calculate department-wise salary distribution
    const departmentStats = {};
    const positionStats = {};
    
    payrolls.forEach(payroll => {
      // Department analysis
      const dept = payroll.employeeDetails?.department || 'Unknown';
      if (!departmentStats[dept]) {
        departmentStats[dept] = { 
          count: 0, 
          total: 0, 
          grossSalary: 0, 
          basicSalary: 0,
          deductions: 0, 
          bonuses: 0,
          employees: new Set()
        };
      }
      departmentStats[dept].count++;
      departmentStats[dept].total += (payroll.netSalary || 0);
      departmentStats[dept].grossSalary += (payroll.grossSalary || 0);
      departmentStats[dept].basicSalary += (payroll.basicSalary || 0);
      departmentStats[dept].deductions += (payroll.totalDeductions || 0);
      departmentStats[dept].bonuses += (payroll.bonus || 0);
      departmentStats[dept].employees.add(payroll.employeeId.toString());
      
      // Position/role analysis
      const position = payroll.employeeDetails?.position || 'Unknown';
      if (!positionStats[position]) {
        positionStats[position] = { count: 0, total: 0, employees: new Set() };
      }
      positionStats[position].count++;
      positionStats[position].total += (payroll.netSalary || 0);
      positionStats[position].employees.add(payroll.employeeId.toString());
    });
    
    // Calculate advanced department-wise metrics
    for (const [dept, data] of Object.entries(departmentStats)) {
      analytics.salaryByDepartment[dept] = {
        total: data.total,
        average: data.total / data.count,
        employees: data.employees.size,
        records: data.count,
        grossSalary: data.grossSalary,
        basicSalary: data.basicSalary,
        deductions: data.deductions,
        bonuses: data.bonuses,
        costShare: data.total / analytics.totalNetSalary * 100 // Percentage of total payroll
      };
    }
    
    // Calculate position/role-wise salary metrics
    for (const [position, data] of Object.entries(positionStats)) {
      analytics.salaryByPosition[position] = {
        total: data.total,
        average: data.total / data.count,
        employees: data.employees.size,
        records: data.count,
        costShare: data.total / analytics.totalNetSalary * 100
      };
    }
    
    // Calculate salary component allocation
    const totalAllocation = analytics.totalBasicSalary + analytics.totalDeductions + analytics.bonusDistributed + analytics.overtimeAmountTotal;
    analytics.allocationByComponent = {
      basicSalary: {
        amount: analytics.totalBasicSalary,
        percentage: (analytics.totalBasicSalary / totalAllocation) * 100
      },
      deductions: {
        amount: analytics.totalDeductions,
        percentage: (analytics.totalDeductions / totalAllocation) * 100,
        breakdown: {
          tax: analytics.taxDeductions,
          pf: analytics.pfDeductions,
          other: analytics.otherDeductions
        }
      },
      bonus: {
        amount: analytics.bonusDistributed,
        percentage: (analytics.bonusDistributed / totalAllocation) * 100
      },
      overtime: {
        amount: analytics.overtimeAmountTotal,
        percentage: (analytics.overtimeAmountTotal / totalAllocation) * 100
      }
    };
    
    // Calculate deduction breakdown percentages
    analytics.deductionBreakdown = {
      tax: analytics.taxDeductions / analytics.totalDeductions * 100,
      pf: analytics.pfDeductions / analytics.totalDeductions * 100,
      others: analytics.otherDeductions / analytics.totalDeductions * 100
    };
    
    // Calculate month-wise salary trend with enhanced metrics
    const monthlyTrend = {};
    payrolls.forEach(payroll => {
      const key = `${payroll.year}-${payroll.month.toString().padStart(2, '0')}`;
      const monthName = new Date(payroll.year, payroll.month-1, 1).toLocaleString('default', { month: 'long' });
      
      if (!monthlyTrend[key]) {
        monthlyTrend[key] = { 
          total: 0, 
          count: 0, 
          taxes: 0, 
          bonus: 0,
          deductions: 0,
          grossSalary: 0,
          overtime: 0,
          employees: new Set(),
          monthName,
          month: payroll.month,
          year: payroll.year,
          quarterNumber: Math.ceil(payroll.month / 3)
        };
      }
      monthlyTrend[key].total += (payroll.netSalary || 0);
      monthlyTrend[key].count++;
      monthlyTrend[key].taxes += (payroll.deductions?.incomeTax || 0);
      monthlyTrend[key].bonus += (payroll.bonus || 0);
      monthlyTrend[key].deductions += (payroll.totalDeductions || 0);
      monthlyTrend[key].grossSalary += (payroll.grossSalary || 0);
      monthlyTrend[key].overtime += (payroll.overtime?.amount || 0);
      monthlyTrend[key].employees.add(payroll.employeeId.toString());
    });
    
    // Sort and format the trend data with YoY and MoM changes
    const sortedKeys = Object.keys(monthlyTrend).sort();
    
    analytics.salaryTrend = sortedKeys.map((key, index) => {
      const current = monthlyTrend[key];
      const previousMonthKey = index > 0 ? sortedKeys[index - 1] : null;
      const previousMonth = previousMonthKey ? monthlyTrend[previousMonthKey] : null;
      
      // Find same month last year for YoY comparison
      const yearAgoKey = sortedKeys.find(k => {
        const parts = k.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        return year === current.year - 1 && month === current.month;
      });
      const yearAgo = yearAgoKey ? monthlyTrend[yearAgoKey] : null;
      
      return {
        period: key,
        monthName: current.monthName,
        month: current.month,
        year: current.year,
        quarter: `Q${current.quarterNumber} ${current.year}`,
        totalSalary: current.total,
        grossSalary: current.grossSalary,
        averageSalary: current.total / current.count,
        headcount: current.employees.size,
        records: current.count,
        taxes: current.taxes,
        bonus: current.bonus,
        deductions: current.deductions,
        overtime: current.overtime,
        // Month-over-Month and Year-over-Year changes
        mom: previousMonth ? {
          totalSalary: ((current.total - previousMonth.total) / previousMonth.total) * 100,
          headcount: ((current.employees.size - previousMonth.employees.size) / previousMonth.employees.size) * 100
        } : null,
        yoy: yearAgo ? {
          totalSalary: ((current.total - yearAgo.total) / yearAgo.total) * 100,
          headcount: ((current.employees.size - yearAgo.employees.size) / yearAgo.employees.size) * 100
        } : null
      };
    });

    // Payment Status Distribution with percentages
    const totalRecords = payrolls.length;
    const paymentStatusCount = {
      Paid: payrolls.filter(p => p.paymentStatus === 'Paid').length,
      Pending: payrolls.filter(p => p.paymentStatus === 'Pending').length,
      Failed: payrolls.filter(p => p.paymentStatus === 'Failed').length,
      Processing: payrolls.filter(p => p.paymentStatus === 'Processing').length
    };
    
    analytics.paymentStatusDistribution = {
      counts: paymentStatusCount,
      percentages: {
        Paid: totalRecords > 0 ? (paymentStatusCount.Paid / totalRecords) * 100 : 0,
        Pending: totalRecords > 0 ? (paymentStatusCount.Pending / totalRecords) * 100 : 0,
        Failed: totalRecords > 0 ? (paymentStatusCount.Failed / totalRecords) * 100 : 0,
        Processing: totalRecords > 0 ? (paymentStatusCount.Processing / totalRecords) * 100 : 0
      }
    };
    
    // Generate employee performance metrics
    const employeePerformance = new Map();
    
    // Get unique employees
    const uniqueEmployees = new Set(payrolls.map(p => p.employeeId.toString()));
    
    // Analyze each employee's performance metrics
    uniqueEmployees.forEach(empId => {
      const empPayrolls = payrolls.filter(p => p.employeeId.toString() === empId);
      if (empPayrolls.length > 0) {
        const latestPayroll = empPayrolls.sort((a, b) => {
          return (b.year * 12 + b.month) - (a.year * 12 + a.month);
        })[0];
        
        employeePerformance.set(empId, {
          id: empId,
          name: latestPayroll.employeeDetails?.name || 'Unknown',
          department: latestPayroll.employeeDetails?.department || 'Unknown',
          position: latestPayroll.employeeDetails?.position || 'Unknown',
          latestSalary: latestPayroll.netSalary,
          averageSalary: empPayrolls.reduce((sum, p) => sum + p.netSalary, 0) / empPayrolls.length,
          overtimeHours: empPayrolls.reduce((sum, p) => sum + (p.overtime?.hours || 0), 0),
          bonusTotal: empPayrolls.reduce((sum, p) => sum + (p.bonus || 0), 0),
          records: empPayrolls.length
        });
      }
    });
    
    analytics.employeePerformance = Array.from(employeePerformance.values());
    
    // Calculate visualization data for charts
    analytics.chartData = {
      salaryDistribution: Object.entries(analytics.salaryByDepartment).map(([dept, data]) => ({
        department: dept,
        total: data.total,
        percentage: data.total / analytics.totalNetSalary * 100
      })),
      paymentStatus: Object.entries(analytics.paymentStatusDistribution.percentages).map(([status, percentage]) => ({
        status,
        percentage
      })),
      salaryTrends: analytics.salaryTrend.map(trend => ({
        period: trend.period,
        salary: trend.totalSalary,
        employees: trend.headcount
      })),
      deductionRatio: [
        { type: 'Tax', percentage: analytics.deductionBreakdown.tax },
        { type: 'Provident Fund', percentage: analytics.deductionBreakdown.pf },
        { type: 'Other', percentage: analytics.deductionBreakdown.others }
      ]
    };
    
    // If format is 'excel', we'll just return the data
    // Frontend will handle the Excel generation
    
    res.status(200).json({
      success: true,
      data: {
        analytics,
        payrolls: format === 'detailed' ? payrolls : payrolls.map(p => ({
          id: p._id,
          employeeId: p.employeeId,
          name: p.employeeDetails?.name,
          month: p.month,
          year: p.year,
          netSalary: p.netSalary,
          paymentStatus: p.paymentStatus
        }))
      }
    });
  } catch (error) {
    console.error('Error generating payroll reports:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate payroll reports',
      error: error.message
    });
  }
};

// Helper function to calculate tax for comparison between regimes
const calculateTaxForRegime = (annualSalary, deductions, regime) => {
  // Define tax slabs for both regimes
  const taxSlabs = {
    old: [
      { start: 0, end: 250000, rate: 0, description: 'Nil (0-2.5L)' },
      { start: 250000, end: 500000, rate: 0.05, description: '5% (2.5L-5L)' },
      { start: 500000, end: 750000, rate: 0.10, description: '10% (5L-7.5L)' },
      { start: 750000, end: 1000000, rate: 0.15, description: '15% (7.5L-10L)' },
      { start: 1000000, end: 1250000, rate: 0.20, description: '20% (10L-12.5L)' },
      { start: 1250000, end: 1500000, rate: 0.25, description: '25% (12.5L-15L)' },
      { start: 1500000, end: Infinity, rate: 0.30, description: '30% (>15L)' }
    ],
    new: [
      { start: 0, end: 300000, rate: 0, description: 'Nil (0-3L)' },
      { start: 300000, end: 600000, rate: 0.05, description: '5% (3L-6L)' },
      { start: 600000, end: 900000, rate: 0.10, description: '10% (6L-9L)' },
      { start: 900000, end: 1200000, rate: 0.15, description: '15% (9L-12L)' },
      { start: 1200000, end: 1500000, rate: 0.20, description: '20% (12L-15L)' },
      { start: 1500000, end: Infinity, rate: 0.30, description: '30% (>15L)' }
    ]
  };

  // Apply deductions for old regime only
  let taxableIncome = annualSalary;
  if (regime === 'old' && deductions) {
    // Add standard deductions as per tax laws
    const totalDeductions = Math.min(
      (deductions.section80C || 0) + 
      (deductions.section80D || 0) + 
      (deductions.housingLoanInterest || 0) + 
      (deductions.educationLoanInterest || 0) + 
      (deductions.other || 0),
      500000 // Cap total deductions at 5L for simplicity
    );
    taxableIncome = Math.max(0, annualSalary - totalDeductions);
  }

  // Choose applicable slabs
  const applicableSlabs = taxSlabs[regime] || taxSlabs.old;
  
  // Calculate tax
  let totalTax = 0;
  for (const slab of applicableSlabs) {
    if (taxableIncome > slab.start) {
      const slabAmount = Math.min(taxableIncome - slab.start, slab.end - slab.start);
      const slabTax = slabAmount * slab.rate;
      totalTax += slabTax;
      if (taxableIncome <= slab.end) break;
    }
  }

  // Add surcharge and cess
  let surcharge = 0;
  if (regime === 'old' && taxableIncome > 5000000) {
    const surchargeRate = taxableIncome > 10000000 ? 0.15 : 0.10;
    surcharge = totalTax * surchargeRate;
  }

  const cess = (totalTax + surcharge) * 0.04;
  const finalTax = totalTax + surcharge + cess;

  return {
    taxableIncome,
    baseTax: totalTax,
    surcharge,
    cess,
    totalTax: finalTax,
    effectiveRate: (finalTax / annualSalary) * 100,
    regime
  };
};

// Calculate tax for an employee's salary
export const calculateTaxBreakdown = async (req, res) => {
  try {
    const { employeeId, financialYear, month, income, deductions, taxRegime = 'old' } = req.body;
    
    console.log('Tax calculation request received:', req.body);
    
    // Validation
    if (!employeeId || !financialYear) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and financial year are required',
      });
    }
    
    // Get employee data
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found',
      });
    }
    
    console.log(`Calculating tax for employee: ${employee.name}, ID: ${employee._id}, using ${taxRegime} tax regime`);
    
    // Parse the financial year (format: 2023-2024)
    const [startYear, endYear] = financialYear.split('-').map(year => parseInt(year));
    
    // Calculate taxable income
    const annualSalary = income ? parseFloat(income) : employee.salary * 12;
    
    // Calculate tax deductions (Section 80C, 80D, etc.)
    const taxDeductions = {
      section80C: parseFloat(deductions?.section80C || 0),
      section80D: parseFloat(deductions?.section80D || 0),
      housingLoanInterest: parseFloat(deductions?.housingLoanInterest || 0),
      educationLoanInterest: parseFloat(deductions?.educationLoanInterest || 0),
      other: parseFloat(deductions?.other || 0)
    };
    
    // Calculate total deductions (capped at appropriate limits as per Indian tax laws)
    // Section 80C capped at 150,000
    const section80CDeduction = Math.min(taxDeductions.section80C, 150000);
    // Section 80D capped at 25,000 (50,000 for senior citizens)
    const section80DDeduction = Math.min(taxDeductions.section80D, 25000);
    // Housing loan interest deduction (capped at 200,000 for self-occupied property)
    const housingLoanDeduction = Math.min(taxDeductions.housingLoanInterest, 200000);
    // Education loan interest deduction (no cap)
    const educationLoanDeduction = taxDeductions.educationLoanInterest;
    // Other deductions
    const otherDeductions = taxDeductions.other;
    
    // Calculate total deductions
    const totalDeductions = section80CDeduction + section80DDeduction + housingLoanDeduction + educationLoanDeduction + otherDeductions;
    
    // Calculate taxable income
    const taxableIncome = Math.max(0, annualSalary - totalDeductions);
    
    // Define tax slabs for both old and new regimes (FY 2024-25)
    // These should be stored in config and updated yearly
    const taxSlabs = {
      old: [
        { start: 0, end: 250000, rate: 0, description: 'Nil (0-2.5L)' },
        { start: 250000, end: 500000, rate: 0.05, description: '5% (2.5L-5L)' },
        { start: 500000, end: 750000, rate: 0.10, description: '10% (5L-7.5L)' },
        { start: 750000, end: 1000000, rate: 0.15, description: '15% (7.5L-10L)' },
        { start: 1000000, end: 1250000, rate: 0.20, description: '20% (10L-12.5L)' },
        { start: 1250000, end: 1500000, rate: 0.25, description: '25% (12.5L-15L)' },
        { start: 1500000, end: Infinity, rate: 0.30, description: '30% (>15L)' }
      ],
      new: [
        { start: 0, end: 300000, rate: 0, description: 'Nil (0-3L)' },
        { start: 300000, end: 600000, rate: 0.05, description: '5% (3L-6L)' },
        { start: 600000, end: 900000, rate: 0.10, description: '10% (6L-9L)' },
        { start: 900000, end: 1200000, rate: 0.15, description: '15% (9L-12L)' },
        { start: 1200000, end: 1500000, rate: 0.20, description: '20% (12L-15L)' },
        { start: 1500000, end: Infinity, rate: 0.30, description: '30% (>15L)' }
      ]
    };

    // Choose tax regime slabs
    const applicableSlabs = taxSlabs[taxRegime] || taxSlabs.old;
    console.log(`Using ${taxRegime} tax regime with ${applicableSlabs.length} slabs`);
    
    // Calculate tax for each slab
    let totalTax = 0;
    const taxBreakdown = [];
    
    for (const slab of applicableSlabs) {
      if (taxableIncome > slab.start) {
        const slabAmount = Math.min(taxableIncome - slab.start, slab.end - slab.start);
        const slabTax = slabAmount * slab.rate;
        
        totalTax += slabTax;
        
        taxBreakdown.push({
          bracketStart: slab.start,
          bracketEnd: slab.end,
          taxRate: slab.rate,
          description: slab.description,
          taxableAmount: slabAmount,
          taxAmount: slabTax
        });
        
        if (taxableIncome <= slab.end) break;
      }
    }
    
    // Calculate surcharge (only applicable for income above 50L in old regime)
    let surcharge = 0;
    let surchargeRate = 0;
    
    if (taxRegime === 'old' && taxableIncome > 5000000) {
      if (taxableIncome > 10000000) {
        surchargeRate = 0.15; // 15% for income > 1Cr
      } else if (taxableIncome > 7500000) {
        surchargeRate = 0.10; // 10% for income > 75L
      } else if (taxableIncome > 5000000) {
        surchargeRate = 0.05; // 5% for income > 50L
      }
      surcharge = totalTax * surchargeRate;
    }
    
    // Add health & education cess (4% of tax + surcharge)
    const cess = (totalTax + surcharge) * 0.04;
    const finalTaxAmount = totalTax + surcharge + cess;
    
    // Calculate monthly tax contribution
    const monthlyTax = finalTaxAmount / 12;
    
    console.log(`Tax calculation completed: Taxable income: ${taxableIncome}, Total tax: ${totalTax}, Final tax: ${finalTaxAmount}`);
    
    // Return tax calculation
    res.status(200).json({
      success: true,
      data: {
        employeeDetails: {
          name: employee.name,
          employeeID: employee.employeeID,
          department: employee.department,
          position: employee.position
        },
        financialYear,
        regime: {
          name: taxRegime,
          description: taxRegime === 'old' ? 'Old Regime (with deductions)' : 'New Regime (without most deductions)'
        },
        annualSalary,
        deductions: {
          ...taxDeductions,
          section80C: {
            amount: taxDeductions.section80C,
            allowed: section80CDeduction,
            maxLimit: 150000,
            description: 'Investments (PF, ELSS, LIC, etc)'
          },
          section80D: {
            amount: taxDeductions.section80D,
            allowed: section80DDeduction,
            maxLimit: 25000,
            description: 'Medical Insurance Premium'
          },
          housingLoan: {
            amount: taxDeductions.housingLoanInterest,
            allowed: housingLoanDeduction,
            maxLimit: 200000,
            description: 'Interest on Housing Loan'
          },
          educationLoan: {
            amount: taxDeductions.educationLoanInterest,
            allowed: educationLoanDeduction,
            description: 'Interest on Education Loan'
          },
          other: {
            amount: taxDeductions.other,
            allowed: otherDeductions,
            description: 'Other Deductions'
          }
        },
        totalDeductions,
        taxableIncome,
        taxBreakdown,
        tax: {
          baseTax: totalTax,
          surcharge: {
            rate: surchargeRate * 100,
            amount: surcharge,
            applicable: surcharge > 0
          },
          cess: {
            rate: 4,
            amount: cess,
            description: 'Health & Education Cess'
          },
          total: finalTaxAmount,
          monthly: monthlyTax
        },
        taxSavings: taxRegime === 'old' ? {
          withoutDeductions: (annualSalary * 0.3) - finalTaxAmount, // Simplified calculation 
          withNewRegime: 0 // To be calculated comparing with new regime
        } : null
      }
    });
  } catch (error) {
    console.error('Error calculating tax breakdown:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate tax breakdown',
      error: error.message
    });
  }
};

// Manage bonus and incentives
export const manageBonusIncentives = async (req, res) => {
  try {
    const {
      payrollId,
      bonusDetails,
      description
    } = req.body;

    // Validation
    if (!payrollId) {
      return res.status(400).json({
        success: false,
        message: 'Payroll ID is required'
      });
    }

    // Find the payroll record
    const payroll = await Payroll.findById(payrollId);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll record not found'
      });
    }

    // Initialize bonus details if not present
    if (!payroll.bonusDetails) {
      payroll.bonusDetails = {
        performanceBonus: 0,
        festivalBonus: 0,
        incentives: 0,
        commission: 0,
        oneTimeBonus: 0,
        description: ''
      };
    }

    // Update bonus details
    if (bonusDetails) {
      Object.keys(bonusDetails).forEach(key => {
        if (key in payroll.bonusDetails && key !== 'description') {
          payroll.bonusDetails[key] = parseFloat(bonusDetails[key]) || 0;
        }
      });
    }

    // Update description if provided
    if (description !== undefined) {
      payroll.bonusDetails.description = description;
    }

    // Calculate total bonus
    const totalBonus = (
      (payroll.bonusDetails.performanceBonus || 0) +
      (payroll.bonusDetails.festivalBonus || 0) +
      (payroll.bonusDetails.incentives || 0) +
      (payroll.bonusDetails.commission || 0) +
      (payroll.bonusDetails.oneTimeBonus || 0)
    );

    // Update the total bonus
    payroll.bonus = totalBonus;

    // Save the updated payroll
    await payroll.save();

    res.status(200).json({
      success: true,
      message: 'Bonus and incentives updated successfully',
      data: payroll
    });
  } catch (error) {
    console.error('Error managing bonus and incentives:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bonus and incentives',
      error: error.message
    });
  }
};

// Bulk manage bonus for multiple employees
export const bulkManageBonus = async (req, res) => {
  try {
    const {
      employees,
      bonusType,
      bonusAmount,
      description,
      month,
      year
    } = req.body;

    // Validation
    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Employees array is required'
      });
    }

    if (!bonusType || !bonusAmount) {
      return res.status(400).json({
        success: false,
        message: 'Bonus type and amount are required'
      });
    }

    // Ensure bonusType is valid
    const validBonusTypes = ['performanceBonus', 'festivalBonus', 'incentives', 'commission', 'oneTimeBonus'];
    if (!validBonusTypes.includes(bonusType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bonus type'
      });
    }

    // Use current month/year if not provided
    const currentDate = new Date();
    const bonusMonth = month || currentDate.getMonth() + 1;
    const bonusYear = year || currentDate.getFullYear();

    // Results tracking
    const results = {
      success: [],
      failed: []
    };

    // Process each employee
    for (const employeeId of employees) {
      try {
        // Find the payroll record for this employee for the given month/year
        let payroll = await Payroll.findOne({
          employeeId,
          month: bonusMonth,
          year: bonusYear
        });

        // If no payroll exists, we might need to create one or skip
        if (!payroll) {
          // Get employee data
          const employee = await Employee.findById(employeeId);
          if (!employee) {
            results.failed.push({
              employeeId,
              reason: 'Employee not found'
            });
            continue;
          }

          // Only create payroll for current or past months
          const isPastOrCurrentMonth = 
            (bonusYear < currentDate.getFullYear()) || 
            (bonusYear === currentDate.getFullYear() && bonusMonth <= currentDate.getMonth() + 1);

          if (!isPastOrCurrentMonth) {
            results.failed.push({
              employeeId,
              name: employee.name,
              reason: 'Cannot add bonus to future month'
            });
            continue;
          }

          // Create a basic payroll entry
          payroll = new Payroll({
            employeeId,
            month: bonusMonth,
            year: bonusYear,
            employeeDetails: {
              name: employee.name,
              employeeID: employee.employeeID,
              department: employee.department,
              position: employee.position,
              joiningDate: employee.joiningDate,
              bankDetails: {
                bankName: employee.bankDetails?.bankName || employee.bankName || '',
                accountNumber: employee.bankDetails?.accountNumber || employee.accountNumber || '',
                accountHolderName: employee.bankDetails?.accountHolderName || employee.accountHolderName || employee.name || '',
                ifscCode: employee.bankDetails?.ifscCode || employee.ifscCode || ''
              }
            },
            basicSalary: employee.salary,
            paymentStatus: 'Pending'
          });
        }

        // Initialize bonus details if not present
        if (!payroll.bonusDetails) {
          payroll.bonusDetails = {
            performanceBonus: 0,
            festivalBonus: 0,
            incentives: 0,
            commission: 0,
            oneTimeBonus: 0,
            description: ''
          };
        }

        // Update the specified bonus type
        payroll.bonusDetails[bonusType] = parseFloat(bonusAmount) || 0;

        // Append to description if provided
        if (description) {
          const currentDesc = payroll.bonusDetails.description || '';
          payroll.bonusDetails.description = currentDesc 
            ? `${currentDesc}; ${description}` 
            : description;
        }

        // Calculate total bonus
        const totalBonus = (
          (payroll.bonusDetails.performanceBonus || 0) +
          (payroll.bonusDetails.festivalBonus || 0) +
          (payroll.bonusDetails.incentives || 0) +
          (payroll.bonusDetails.commission || 0) +
          (payroll.bonusDetails.oneTimeBonus || 0)
        );

        // Update the total bonus
        payroll.bonus = totalBonus;

        // Save the updated payroll
        await payroll.save();

        results.success.push({
          employeeId,
          name: payroll.employeeDetails.name,
          bonusAmount: parseFloat(bonusAmount),
          totalBonus: payroll.bonus
        });
      } catch (error) {
        console.error(`Error processing bonus for employee ${employeeId}:`, error);
        results.failed.push({
          employeeId,
          reason: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Processed bonus for ${results.success.length} employees (${results.failed.length} failed)`,
      data: results
    });
  } catch (error) {
    console.error('Error in bulk bonus management:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk bonus',
      error: error.message
    });
  }
};

// Recalculate payroll
export const recalculatePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find payroll
    const payroll = await Payroll.findById(id);
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Payroll not found'
      });
    }
    
    // Don't recalculate if already paid
    if (payroll.paymentStatus === 'Paid') {
      return res.status(400).json({
        success: false,
        message: 'Cannot recalculate a paid payroll'
      });
    }
    
    // Get employee
    const employee = await Employee.findById(payroll.employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Get attendance summary
    const { attendanceSummary } = payroll;
    const daysInMonth = getDaysInMonth(payroll.month, payroll.year);
    
    // Calculate working days and proration factor
    const workingDays = attendanceSummary.present + attendanceSummary.late;
    const proratedFactor = Math.max(workingDays / daysInMonth, 0.1); // At least 10% to avoid zero
    
    // Get the original salary (or use the one stored in payroll if available)
    const originalSalary = payroll.originalSalary || employee.salary || 15300;
    
    // Calculate prorated basic salary
    const proratedBasic = originalSalary * proratedFactor;
    
    // Recalculate allowances based on the original salary (but prorated)
    const allowances = {
      houseRent: Math.round(originalSalary * 0.4 * proratedFactor * 100) / 100, // 40% of basic
      medical: Math.round(originalSalary * 0.1 * proratedFactor * 100) / 100, // 10% of basic
      travel: Math.round(originalSalary * 0.05 * proratedFactor * 100) / 100, // 5% of basic
      food: Math.round(originalSalary * 0.05 * proratedFactor * 100) / 100, // 5% of basic
      special: payroll.allowances?.special || 0,
      other: payroll.allowances?.other || 0
    };
    
    // Calculate attendance-based deductions
    const absentDeduction = attendanceSummary.absent * 100; // ₹100 per day
    const lateDeduction = attendanceSummary.late * 25; // ₹25 per day
    const leaveDeduction = attendanceSummary.onLeave * 45; // ₹45 per day
    
    // Recalculate deductions
    const deductions = {
      professionalTax: Math.round(15 * proratedFactor), // ₹15 (prorated)
      incomeTax: payroll.deductions?.incomeTax || 0,
      providentFund: Math.round(48 * proratedFactor), // ₹48 (prorated)
      healthInsurance: Math.round(20 * proratedFactor), // ₹20 (prorated)
      loanRepayment: payroll.deductions?.loanRepayment || 0,
      absentDeduction: absentDeduction,
      lateDeduction: lateDeduction,
      other: payroll.deductions?.other || 0
    };
    
    // Recalculate totals
    const totalAllowances = Object.values(allowances).reduce((a, b) => a + b, 0);
    const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0) + leaveDeduction;
    
    // Recalculate gross and net salary
    const grossSalary = proratedBasic + totalAllowances + (payroll.overtime?.amount || 0) + (payroll.bonus || 0);
    const netSalary = grossSalary - totalDeductions;
    
    // Update payroll
    payroll.originalSalary = originalSalary;
    payroll.basicSalary = proratedBasic;
    payroll.allowances = allowances;
    payroll.deductions = deductions;
    payroll.leaveDeduction = leaveDeduction;
    payroll.grossSalary = grossSalary;
    payroll.totalDeductions = totalDeductions;
    payroll.netSalary = netSalary;
    payroll.lastCalculated = new Date();
    
    await payroll.save();
    
    return res.status(200).json({
      success: true,
      message: 'Payroll recalculated successfully',
      data: payroll
    });
    
  } catch (error) {
    console.error('Error recalculating payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while recalculating payroll',
      error: error.message
    });
  }
};
