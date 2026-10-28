`timescale 1ns/1ps

module railguard_tb;

    reg clk, rst;
    reg train_approach;
    reg train_in_crossing;
    reg gate_closed, gate_open;

    wire warning_light;
    wire road_stop;
    wire gate_close_cmd, gate_open_cmd;
    wire fault;
    wire [2:0] state_debug;

    integer errors;
    integer trace_fd;

    railguard_controller #(
        .WARN_CYCLES(3),
        .GATE_TIMEOUT(5)
    ) dut (
        .clk(clk),
        .rst(rst),
        .train_approach(train_approach),
        .train_in_crossing(train_in_crossing),
        .gate_closed(gate_closed),
        .gate_open(gate_open),
        .warning_light(warning_light),
        .road_stop(road_stop),
        .gate_close_cmd(gate_close_cmd),
        .gate_open_cmd(gate_open_cmd),
        .fault(fault),
        .state_debug(state_debug)
    );

    // 10 ns clock period
    always #5 clk = ~clk;

    // ------------------------------------------------
    // CSV trace generation for the animation
    // ------------------------------------------------

    always @(posedge clk) begin
        #1;

        if (trace_fd != 0) begin
            $fdisplay(trace_fd,
                "%0t,%0d,%b,%b,%b,%b,%b,%b,%b,%b,%b",
                $time,
                state_debug,
                train_approach,
                train_in_crossing,
                gate_closed,
                gate_open,
                warning_light,
                road_stop,
                gate_close_cmd,
                gate_open_cmd,
                fault
            );
        end
    end

    // ------------------------------------------------
    // Immediate assertion monitor
    // ------------------------------------------------

    always @(negedge clk) begin
        if (!rst) begin
            case (state_debug)

                // IDLE
                3'd0: assert (
                    warning_light == 0 &&
                    road_stop == 0 &&
                    gate_close_cmd == 0 &&
                    gate_open_cmd == 1 &&
                    fault == 0
                ) else $fatal(1, "Assertion failed: IDLE");

                // WARNING
                3'd1: assert (
                    warning_light == 1 &&
                    road_stop == 1 &&
                    gate_close_cmd == 0 &&
                    gate_open_cmd == 1 &&
                    fault == 0
                ) else $fatal(1, "Assertion failed: WARNING");

                // CLOSING
                3'd2: assert (
                    warning_light == 1 &&
                    road_stop == 1 &&
                    gate_close_cmd == 1 &&
                    gate_open_cmd == 0 &&
                    fault == 0
                ) else $fatal(1, "Assertion failed: CLOSING");

                // PASSING
                3'd3: assert (
                    warning_light == 1 &&
                    road_stop == 1 &&
                    gate_close_cmd == 1 &&
                    gate_open_cmd == 0 &&
                    fault == 0
                ) else $fatal(1, "Assertion failed: PASSING");

                // OPENING
                3'd4: assert (
                    warning_light == 1 &&
                    road_stop == 1 &&
                    gate_close_cmd == 0 &&
                    gate_open_cmd == 1 &&
                    fault == 0
                ) else $fatal(1, "Assertion failed: OPENING");

                // FAULT
                3'd5: assert (
                    warning_light == 1 &&
                    road_stop == 1 &&
                    gate_close_cmd == 1 &&
                    gate_open_cmd == 0 &&
                    fault == 1
                ) else $fatal(1, "Assertion failed: FAULT");

                // WAIT_FOR_TRAIN
                3'd6: assert (
                    warning_light == 1 &&
                    road_stop == 1 &&
                    gate_close_cmd == 1 &&
                    gate_open_cmd == 0 &&
                    fault == 0
                ) else $fatal(1, "Assertion failed: WAIT_FOR_TRAIN");

                default:
                    $fatal(1, "Assertion failed: Invalid FSM state");

            endcase
        end
    end

    // ------------------------------------------------
    // Main test scenarios
    // ------------------------------------------------

    initial begin

        // Waveform output
        $dumpfile("railguard.vcd");
        $dumpvars(0, railguard_tb);

        // CSV trace output
        trace_fd = $fopen("railguard_trace.csv", "w");

        if (trace_fd == 0)
            $fatal(1, "Could not create CSV trace file");

        $fdisplay(trace_fd,
            "time_ps,state,train_approach,train_in_crossing,gate_closed,gate_open,warning_light,road_stop,gate_close_cmd,gate_open_cmd,fault"
        );

        // Initial input values
        clk = 0;
        rst = 1;

        train_approach = 0;
        train_in_crossing = 0;
        gate_closed = 0;
        gate_open = 1;

        errors = 0;

        $display("=== RAILGUARD VERIFICATION STARTED ===");

        // ============================================
        // TEST 0: Initial IDLE outputs
        // ============================================

        #1;

        if (state_debug !== 3'd0 ||
            warning_light !== 0 ||
            road_stop !== 0 ||
            gate_close_cmd !== 0 ||
            gate_open_cmd !== 1 ||
            fault !== 0) begin

            $display("FAIL: Initial IDLE outputs");
            errors = errors + 1;
        end
        else begin
            $display("PASS: Initial IDLE outputs");
        end

        // Release reset
        #11 rst = 0;

        // ============================================
        // TEST 1: Normal railway crossing
        // ============================================

        // Train is detected at the approach sensor
        @(negedge clk);
        train_approach = 1;

        wait (state_debug == 3'd1);
        #1;

        if (warning_light !== 1 ||
            road_stop !== 1 ||
            gate_open_cmd !== 1 ||
            gate_close_cmd !== 0) begin

            $display("FAIL: WARNING outputs");
            errors = errors + 1;
        end
        else begin
            $display("PASS: WARNING outputs");
        end

        @(negedge clk);
        train_approach = 0;

        // Wait for warning interval to finish
        wait (state_debug == 3'd2);
        #1;

        if (warning_light !== 1 ||
            road_stop !== 1 ||
            gate_close_cmd !== 1 ||
            gate_open_cmd !== 0) begin

            $display("FAIL: CLOSING outputs");
            errors = errors + 1;
        end
        else begin
            $display("PASS: CLOSING outputs");
        end

        // Simulate gate closure before train arrival
        @(negedge clk);
        gate_closed = 1;
        gate_open = 0;

        // Verify controller waits with the gate closed
        wait (state_debug == 3'd6);
        #1;

        if (warning_light !== 1 ||
            road_stop !== 1 ||
            gate_close_cmd !== 1 ||
            gate_open_cmd !== 0 ||
            fault !== 0) begin

            $display("FAIL: WAIT_FOR_TRAIN outputs");
            errors = errors + 1;
        end
        else begin
            $display("PASS: WAIT_FOR_TRAIN outputs");
        end

        // Let the train approach the crossing
        repeat (3) @(negedge clk);

        // Train reaches the crossing only after closure
        train_in_crossing = 1;

        wait (state_debug == 3'd3);
        #1;

        if (warning_light !== 1 ||
            road_stop !== 1 ||
            gate_close_cmd !== 1 ||
            gate_open_cmd !== 0 ||
            fault !== 0) begin

            $display("FAIL: PASSING outputs");
            errors = errors + 1;
        end
        else begin
            $display("PASS: PASSING outputs");
        end

        // Keep the train in the crossing for several cycles
        repeat (3) @(negedge clk);

        // Train clears the crossing
        train_in_crossing = 0;
        gate_closed = 0;

        wait (state_debug == 3'd4);
        #1;

        if (warning_light !== 1 ||
            road_stop !== 1 ||
            gate_close_cmd !== 0 ||
            gate_open_cmd !== 1 ||
            fault !== 0) begin

            $display("FAIL: OPENING outputs");
            errors = errors + 1;
        end
        else begin
            $display("PASS: OPENING outputs");
        end

        // Simulate successful gate opening
        repeat (2) @(negedge clk);
        gate_open = 1;

        wait (state_debug == 3'd0);
        #1;

        if (warning_light !== 0 ||
            road_stop !== 0 ||
            gate_close_cmd !== 0 ||
            gate_open_cmd !== 1 ||
            fault !== 0) begin

            $display("FAIL: Return to IDLE");
            errors = errors + 1;
        end
        else begin
            $display("PASS: Return to IDLE");
        end

        // ============================================
        // TEST 2: Gate fails to close
        // ============================================

        @(negedge clk);
        train_approach = 1;

        @(negedge clk);
        train_approach = 0;

        // gate_closed deliberately remains LOW
        wait (state_debug == 3'd2);
        wait (state_debug == 3'd5);
        #1;

        if (fault !== 1 ||
            warning_light !== 1 ||
            road_stop !== 1 ||
            gate_close_cmd !== 1 ||
            gate_open_cmd !== 0) begin

            $display("FAIL: Gate-closing timeout");
            errors = errors + 1;
        end
        else begin
            $display("PASS: Gate-closing timeout detected");
        end

        // ============================================
        // TEST 3: Reset recovery from FAULT
        // ============================================

        @(negedge clk);
        rst = 1;

        train_approach = 0;
        train_in_crossing = 0;
        gate_closed = 0;
        gate_open = 1;

        #1;

        if (state_debug !== 3'd0 ||
            warning_light !== 0 ||
            road_stop !== 0 ||
            gate_close_cmd !== 0 ||
            gate_open_cmd !== 1 ||
            fault !== 0) begin

            $display("FAIL: Reset recovery");
            errors = errors + 1;
        end
        else begin
            $display("PASS: Reset recovery from FAULT");
        end

        // Release reset
        @(negedge clk);
        rst = 0;

        // ============================================
        // TEST 4: Gate fails to open
        // ============================================

        @(negedge clk);
        train_approach = 1;

        @(negedge clk);
        train_approach = 0;

        wait (state_debug == 3'd2);

        // Gate successfully closes before train arrival
        @(negedge clk);
        gate_closed = 1;
        gate_open = 0;

        wait (state_debug == 3'd6);

        // Train approaches the crossing
        repeat (3) @(negedge clk);
        train_in_crossing = 1;

        wait (state_debug == 3'd3);

        // Train passes and clears the crossing
        repeat (3) @(negedge clk);
        train_in_crossing = 0;
        gate_closed = 0;

        // Gate remains unconfirmed open
        wait (state_debug == 3'd4);
        wait (state_debug == 3'd5);
        #1;

        if (fault !== 1 ||
            warning_light !== 1 ||
            road_stop !== 1 ||
            gate_close_cmd !== 1 ||
            gate_open_cmd !== 0) begin

            $display("FAIL: Gate-opening timeout");
            errors = errors + 1;
        end
        else begin
            $display("PASS: Gate-opening timeout detected");
        end

        // ============================================
        // Final verification summary
        // ============================================

        $display("--------------------------------");

        if (errors == 0)
            $display("ALL TESTS PASSED");
        else
            $display("TESTS FAILED: %0d error(s)", errors);

        // Allow the final trace samples to finish
        #2;
        $fclose(trace_fd);
        $finish;

    end

endmodule